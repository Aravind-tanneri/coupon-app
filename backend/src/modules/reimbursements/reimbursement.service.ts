import { Prisma, ReimbursementStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { NotFoundError, BusinessRuleError } from "../../lib/errors.js";
import { parseDateIST, formatDateIST, getTodayISTString } from "../../lib/dates-ist.js";
import { generateShortCode } from "../../lib/tokens.js";
import { encryptPayout, decryptPayout, maskPayout } from "../../lib/crypto.js";
import { auditService } from "../audit/audit.service.js";
import { calculateReimbursement, PolicyDTO, ExistingClaimDTO } from "./calculator.js";
import { validateTransition, assertVersionMatch } from "./workflow.js";
import {
  SaveDraftClaimInput,
  ApproveClaimInput,
  RejectClaimInput,
  RequestInfoInput,
  RecordPaymentInput,
  ClaimListQuery,
} from "./reimbursement.schemas.js";

export class ReimbursementService {
  /**
   * Runs the pure calculation engine using the student's mess policies and active claims.
   */
  async calculateForStudent(
    studentId: string,
    startDateStr: string,
    endDateStr: string,
    todayStr = getTodayISTString(),
  ) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { mess: true },
    });

    if (!student) {
      throw new NotFoundError(`Student ${studentId} not found`);
    }

    const [policies, existingClaims] = await Promise.all([
      prisma.reimbursementPolicy.findMany({
        where: { messId: student.messId },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.reimbursementRequest.findMany({
        where: {
          studentId,
          status: {
            notIn: [
              ReimbursementStatus.DRAFT,
              ReimbursementStatus.REJECTED,
              ReimbursementStatus.CANCELLED,
            ],
          },
        },
        select: {
          id: true,
          publicRef: true,
          startDate: true,
          endDate: true,
          status: true,
        },
      }),
    ]);

    const policiesDto: PolicyDTO[] = policies.map((p) => ({
      id: p.id,
      messId: p.messId,
      dailyRatePaise: p.dailyRatePaise,
      minAbsenceDays: p.minAbsenceDays,
      effectiveFrom: p.effectiveFrom,
      effectiveUntil: p.effectiveUntil,
      claimDeadlineDays: p.claimDeadlineDays,
      maxAbsenceDays: p.maxAbsenceDays,
      documentRequired: p.documentRequired,
    }));

    const claimsDto: ExistingClaimDTO[] = existingClaims.map((c) => ({
      id: c.id,
      publicRef: c.publicRef,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
    }));

    return calculateReimbursement({
      startDate: startDateStr,
      endDate: endDateStr,
      today: todayStr,
      policies: policiesDto,
      existingClaims: claimsDto,
    });
  }

  /**
   * Creates or updates a DRAFT claim for a student.
   */
  async saveDraft(studentId: string, input: SaveDraftClaimInput) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { mess: true },
    });

    if (!student) {
      throw new NotFoundError(`Student ${studentId} not found`);
    }

    // Run authoritative calculation
    const calc = await this.calculateForStudent(studentId, input.startDate, input.endDate);

    const encryptedPayout = input.payoutDetails
      ? encryptPayout(input.payoutDetails.trim())
      : undefined;

    const studentSnapshot = {
      name: student.name,
      rollNo: student.rollNo,
      department: student.department,
      messCode: student.mess.code,
    };

    const startDate = parseDateIST(input.startDate);
    const endDate = parseDateIST(input.endDate);

    // Find if student already has a draft
    const existingDraft = await prisma.reimbursementRequest.findFirst({
      where: {
        studentId,
        status: ReimbursementStatus.DRAFT,
      },
    });

    if (existingDraft) {
      return prisma.reimbursementRequest.update({
        where: { id: existingDraft.id },
        data: {
          startDate,
          endDate,
          countedDays: calc.countedDays,
          claimedAmountPaise: calc.claimablePaise,
          rateAtClaimPaise: calc.rateAtClaimPaise,
          calculationBreakdown: (calc.breakdown ?? {}) as unknown as Prisma.InputJsonValue,
          reason: input.reason ?? existingDraft.reason,
          encryptedPayout: encryptedPayout ?? existingDraft.encryptedPayout,
          studentSnapshot: studentSnapshot as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
    }

    // Generate new public reference
    const year = new Date().getFullYear();
    const publicRef = `CLM-${year}-${generateShortCode(5)}`;

    return prisma.reimbursementRequest.create({
      data: {
        publicRef,
        messId: student.messId,
        studentId,
        startDate,
        endDate,
        countedDays: calc.countedDays,
        claimedAmountPaise: calc.claimablePaise,
        rateAtClaimPaise: calc.rateAtClaimPaise,
        calculationBreakdown: (calc.breakdown ?? {}) as unknown as Prisma.InputJsonValue,
        reason: input.reason,
        encryptedPayout,
        studentSnapshot: studentSnapshot as unknown as Prisma.InputJsonValue,
        status: ReimbursementStatus.DRAFT,
        version: 1,
      },
    });
  }

  /**
   * Submits a DRAFT claim. Recalculates on server; ignores any client financial amounts.
   */
  async submitClaim(studentId: string, requestId?: string) {
    const claim = await prisma.reimbursementRequest.findFirst({
      where: requestId
        ? { id: requestId, studentId }
        : { studentId, status: ReimbursementStatus.DRAFT },
      include: { student: true, mess: true },
    });

    if (!claim) {
      throw new NotFoundError("No draft claim found to submit");
    }

    if (claim.status !== ReimbursementStatus.DRAFT) {
      throw new BusinessRuleError(
        "CANNOT_SUBMIT",
        `Claim is in ${claim.status} status and cannot be submitted.`,
      );
    }

    // Re-verify eligibility with server-side calculation
    const startStr = formatDateIST(claim.startDate);
    const endStr = formatDateIST(claim.endDate);
    const calc = await this.calculateForStudent(studentId, startStr, endStr);

    if (!calc.eligible) {
      throw new BusinessRuleError(
        calc.reason || "CLAIM_NOT_ELIGIBLE",
        calc.message || "Claim dates are no longer eligible for reimbursement.",
      );
    }

    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reimbursementRequest.update({
        where: { id: claim.id },
        data: {
          status: ReimbursementStatus.SUBMITTED,
          claimedAmountPaise: calc.claimablePaise,
          rateAtClaimPaise: calc.rateAtClaimPaise,
          calculationBreakdown: (calc.breakdown ?? {}) as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });

      await tx.reimbursementStatusHistory.create({
        data: {
          requestId: claim.id,
          fromStatus: ReimbursementStatus.DRAFT,
          toStatus: ReimbursementStatus.SUBMITTED,
          actorType: "STUDENT",
          actorId: studentId,
          at: now,
        },
      });

      // Notification hook (Phase 10)
      await tx.notification.create({
        data: {
          studentId: claim.studentId,
          channel: "WHATSAPP",
          template: "reimbursement_submitted",
          payload: {
            claimRef: claim.publicRef,
            status: ReimbursementStatus.SUBMITTED,
            claimedAmountPaise: updated.claimedAmountPaise,
            countedDays: updated.countedDays,
          },
          status: "PENDING",
        },
      });

      await auditService.log({
        actorType: "STUDENT",
        actorId: studentId,
        action: "REIMBURSEMENT_CLAIM_SUBMITTED",
        entityType: "ReimbursementRequest",
        entityId: claim.id,
        after: {
          publicRef: claim.publicRef,
          claimedAmountPaise: updated.claimedAmountPaise,
          countedDays: updated.countedDays,
        },
      });

      return updated;
    });
  }

  /**
   * Retrieves single claim details with masked payout and full history.
   */
  async getClaim(id: string, actorMessId?: string) {
    const claim = await prisma.reimbursementRequest.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, rollNo: true, name: true, department: true } },
        mess: { select: { id: true, code: true, name: true } },
        documents: true,
        statusHistory: { orderBy: { at: "desc" } },
        payments: { orderBy: { paidAt: "desc" } },
      },
    });

    if (!claim) {
      throw new NotFoundError(`Reimbursement claim ${id} not found`);
    }

    if (actorMessId && claim.messId !== actorMessId) {
      throw new BusinessRuleError("WRONG_MESS", "Claim belongs to a different mess");
    }

    let maskedPayout: string | null = null;
    if (claim.encryptedPayout) {
      try {
        const plain = decryptPayout(claim.encryptedPayout);
        maskedPayout = maskPayout(plain);
      } catch {
        maskedPayout = "****";
      }
    }

    return {
      ...claim,
      maskedPayout,
      encryptedPayout: undefined, // Never expose encrypted cipher to client
    };
  }

  /**
   * Transitions claim: SUBMITTED -> UNDER_REVIEW
   */
  async startReview(claimId: string, adminId: string, expectedVersion?: number, ip?: string) {
    const claim = await prisma.reimbursementRequest.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundError(`Claim ${claimId} not found`);

    assertVersionMatch(claim.version, expectedVersion);
    validateTransition(claim.status, ReimbursementStatus.UNDER_REVIEW, claim.claimedAmountPaise);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reimbursementRequest.update({
        where: { id: claimId, version: claim.version },
        data: {
          status: ReimbursementStatus.UNDER_REVIEW,
          reviewedById: adminId,
          version: { increment: 1 },
        },
      });

      await tx.reimbursementStatusHistory.create({
        data: {
          requestId: claimId,
          fromStatus: claim.status,
          toStatus: ReimbursementStatus.UNDER_REVIEW,
          actorType: "ADMIN",
          actorId: adminId,
        },
      });

      await auditService.log({
        actorType: "ADMIN",
        actorId: adminId,
        action: "REIMBURSEMENT_REVIEW_STARTED",
        entityType: "ReimbursementRequest",
        entityId: claimId,
        ip,
      });

      return updated;
    });
  }

  /**
   * Transitions claim: UNDER_REVIEW -> APPROVED
   */
  async approveClaim(
    claimId: string,
    adminId: string,
    input: ApproveClaimInput,
    actorMessId?: string,
    ip?: string,
  ) {
    const claim = await prisma.reimbursementRequest.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundError(`Claim ${claimId} not found`);

    if (actorMessId && claim.messId !== actorMessId) {
      throw new BusinessRuleError("WRONG_MESS", "Claim belongs to a different mess");
    }

    assertVersionMatch(claim.version, input.version);
    validateTransition(claim.status, ReimbursementStatus.APPROVED, claim.claimedAmountPaise, input);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reimbursementRequest.update({
        where: { id: claimId, version: claim.version },
        data: {
          status: ReimbursementStatus.APPROVED,
          approvedAmountPaise: input.approvedAmountPaise,
          reviewedById: adminId,
          version: { increment: 1 },
        },
      });

      await tx.reimbursementStatusHistory.create({
        data: {
          requestId: claimId,
          fromStatus: claim.status,
          toStatus: ReimbursementStatus.APPROVED,
          actorType: "ADMIN",
          actorId: adminId,
          remarks: input.remarks,
          approvedAmountPaise: input.approvedAmountPaise,
        },
      });

      // Notification hook
      await tx.notification.create({
        data: {
          studentId: claim.studentId,
          channel: "WHATSAPP",
          template: "reimbursement_approved",
          payload: {
            claimRef: claim.publicRef,
            status: ReimbursementStatus.APPROVED,
            approvedAmountPaise: input.approvedAmountPaise,
            remarks: input.remarks,
          },
          status: "PENDING",
        },
      });

      await auditService.log({
        actorType: "ADMIN",
        actorId: adminId,
        action: "REIMBURSEMENT_APPROVED",
        entityType: "ReimbursementRequest",
        entityId: claimId,
        after: {
          approvedAmountPaise: input.approvedAmountPaise,
          remarks: input.remarks,
        },
        ip,
      });

      return updated;
    });
  }

  /**
   * Transitions claim: UNDER_REVIEW -> REJECTED
   */
  async rejectClaim(
    claimId: string,
    adminId: string,
    input: RejectClaimInput,
    actorMessId?: string,
    ip?: string,
  ) {
    const claim = await prisma.reimbursementRequest.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundError(`Claim ${claimId} not found`);

    if (actorMessId && claim.messId !== actorMessId) {
      throw new BusinessRuleError("WRONG_MESS", "Claim belongs to a different mess");
    }

    assertVersionMatch(claim.version, input.version);
    validateTransition(claim.status, ReimbursementStatus.REJECTED, claim.claimedAmountPaise, {
      rejectionReason: input.reason,
    });

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reimbursementRequest.update({
        where: { id: claimId, version: claim.version },
        data: {
          status: ReimbursementStatus.REJECTED,
          rejectionReason: input.reason,
          reviewedById: adminId,
          version: { increment: 1 },
        },
      });

      await tx.reimbursementStatusHistory.create({
        data: {
          requestId: claimId,
          fromStatus: claim.status,
          toStatus: ReimbursementStatus.REJECTED,
          actorType: "ADMIN",
          actorId: adminId,
          remarks: input.reason,
        },
      });

      // Notification hook
      await tx.notification.create({
        data: {
          studentId: claim.studentId,
          channel: "WHATSAPP",
          template: "reimbursement_rejected",
          payload: {
            claimRef: claim.publicRef,
            status: ReimbursementStatus.REJECTED,
            reason: input.reason,
          },
          status: "PENDING",
        },
      });

      await auditService.log({
        actorType: "ADMIN",
        actorId: adminId,
        action: "REIMBURSEMENT_REJECTED",
        entityType: "ReimbursementRequest",
        entityId: claimId,
        after: { reason: input.reason },
        ip,
      });

      return updated;
    });
  }

  /**
   * Transitions claim: UNDER_REVIEW -> INFO_REQUESTED
   */
  async requestInfo(
    claimId: string,
    adminId: string,
    input: RequestInfoInput,
    actorMessId?: string,
    ip?: string,
  ) {
    const claim = await prisma.reimbursementRequest.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundError(`Claim ${claimId} not found`);

    if (actorMessId && claim.messId !== actorMessId) {
      throw new BusinessRuleError("WRONG_MESS", "Claim belongs to a different mess");
    }

    assertVersionMatch(claim.version, input.version);
    validateTransition(claim.status, ReimbursementStatus.INFO_REQUESTED, claim.claimedAmountPaise, {
      remarks: input.message,
    });

    return prisma.$transaction(async (tx) => {
      const updated = await tx.reimbursementRequest.update({
        where: { id: claimId, version: claim.version },
        data: {
          status: ReimbursementStatus.INFO_REQUESTED,
          reviewedById: adminId,
          version: { increment: 1 },
        },
      });

      await tx.reimbursementStatusHistory.create({
        data: {
          requestId: claimId,
          fromStatus: claim.status,
          toStatus: ReimbursementStatus.INFO_REQUESTED,
          actorType: "ADMIN",
          actorId: adminId,
          remarks: input.message,
        },
      });

      // Notification hook
      await tx.notification.create({
        data: {
          studentId: claim.studentId,
          channel: "WHATSAPP",
          template: "reimbursement_info_requested",
          payload: {
            claimRef: claim.publicRef,
            status: ReimbursementStatus.INFO_REQUESTED,
            message: input.message,
          },
          status: "PENDING",
        },
      });

      await auditService.log({
        actorType: "ADMIN",
        actorId: adminId,
        action: "REIMBURSEMENT_INFO_REQUESTED",
        entityType: "ReimbursementRequest",
        entityId: claimId,
        after: { message: input.message },
        ip,
      });

      return updated;
    });
  }

  /**
   * Records a reimbursement payout (UPI, Bank, Cash).
   */
  async recordPayment(
    claimId: string,
    adminId: string,
    input: RecordPaymentInput,
    actorMessId?: string,
    ip?: string,
  ) {
    const claim = await prisma.reimbursementRequest.findUnique({
      where: { id: claimId },
      include: { payments: true },
    });

    if (!claim) throw new NotFoundError(`Claim ${claimId} not found`);

    if (actorMessId && claim.messId !== actorMessId) {
      throw new BusinessRuleError("WRONG_MESS", "Claim belongs to a different mess");
    }

    if (
      claim.status !== ReimbursementStatus.APPROVED &&
      claim.status !== ReimbursementStatus.PAYMENT_PENDING
    ) {
      throw new BusinessRuleError(
        "INVALID_PAYMENT_STATUS",
        `Payments can only be recorded for APPROVED or PAYMENT_PENDING claims. Found: ${claim.status}`,
      );
    }

    const approvedAmount = claim.approvedAmountPaise || claim.claimedAmountPaise;

    // Check existing succeeded payments sum
    const alreadyPaid = claim.payments
      .filter((p) => p.status === "SUCCEEDED")
      .reduce((sum, p) => sum + p.amountPaise, 0);

    if (alreadyPaid + input.amountPaise > approvedAmount) {
      throw new BusinessRuleError(
        "OVERPAYMENT_BLOCKED",
        `Payment of ₹${(input.amountPaise / 100).toFixed(2)} would exceed approved claim total of ₹${(approvedAmount / 100).toFixed(2)}. Already paid: ₹${(alreadyPaid / 100).toFixed(2)}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      // 1. Create Payment record
      const payment = await tx.reimbursementPayment.create({
        data: {
          requestId: claimId,
          amountPaise: input.amountPaise,
          method: input.method,
          reference: input.reference,
          paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
          recordedById: adminId,
          note: input.note,
        },
      });

      const totalPaidNow = alreadyPaid + input.amountPaise;
      const nextStatus =
        totalPaidNow >= approvedAmount
          ? ReimbursementStatus.PAID
          : ReimbursementStatus.PAYMENT_PENDING;

      if (claim.status !== nextStatus) {
        await tx.reimbursementRequest.update({
          where: { id: claimId },
          data: {
            status: nextStatus,
            version: { increment: 1 },
          },
        });

        await tx.reimbursementStatusHistory.create({
          data: {
            requestId: claimId,
            fromStatus: claim.status,
            toStatus: nextStatus,
            actorType: "ADMIN",
            actorId: adminId,
            remarks: `Payment recorded: ₹${(input.amountPaise / 100).toFixed(2)} (${input.reference})`,
          },
        });

        if (nextStatus === ReimbursementStatus.PAID) {
          await tx.notification.create({
            data: {
              studentId: claim.studentId,
              channel: "WHATSAPP",
              template: "reimbursement_paid",
              payload: {
                claimRef: claim.publicRef,
                status: ReimbursementStatus.PAID,
                amountPaise: input.amountPaise,
                reference: input.reference,
              },
              status: "PENDING",
            },
          });
        }
      }

      await auditService.log({
        actorType: "ADMIN",
        actorId: adminId,
        action: "REIMBURSEMENT_PAYMENT_RECORDED",
        entityType: "ReimbursementPayment",
        entityId: payment.id,
        after: {
          amountPaise: payment.amountPaise,
          reference: payment.reference,
          method: payment.method,
          totalPaidNow,
        },
        ip,
      });

      return payment;
    });
  }

  /**
   * Generates a 60-second signed URL for viewing an uploaded reimbursement document.
   * Audited (§23).
   */
  async getDocumentUrl(requestId: string, docId: string, adminId: string, ip?: string) {
    const doc = await prisma.reimbursementDocument.findFirst({
      where: { id: docId, requestId },
      include: { request: true },
    });

    if (!doc) {
      throw new NotFoundError(`Document ${docId} not found for claim ${requestId}`);
    }

    await auditService.log({
      actorType: "ADMIN",
      actorId: adminId,
      action: "REIMBURSEMENT_DOCUMENT_VIEWED",
      entityType: "ReimbursementDocument",
      entityId: doc.id,
      after: {
        requestId,
        storageKey: doc.storageKey,
        originalName: doc.originalName,
      },
      ip,
    });

    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
    return {
      url: `/api/v1/reimbursements/${requestId}/documents/${docId}/file?expires=${encodeURIComponent(expiresAt)}`,
      expiresAt,
      originalName: doc.originalName,
      mime: doc.mime,
      sizeBytes: doc.sizeBytes,
    };
  }

  /**
   * Queries claims with server-side pagination and filters.
   */
  async listClaims(query: ClaimListQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ReimbursementRequestWhereInput = {};

    if (query.messId) where.messId = query.messId;
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { publicRef: { contains: term.toUpperCase(), mode: "insensitive" } },
        { student: { rollNo: { contains: term, mode: "insensitive" } } },
        { student: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.reimbursementRequest.count({ where }),
      prisma.reimbursementRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          student: { select: { id: true, rollNo: true, name: true, department: true } },
          mess: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    return {
      items: items.map((c) => ({
        ...c,
        encryptedPayout: undefined, // Redact
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Status metrics counts for dashboard cards.
   */
  async getStats(messId?: string) {
    const where: Prisma.ReimbursementRequestWhereInput = messId ? { messId } : {};

    const [submitted, underReview, approved, paid, rejected, infoRequested] = await Promise.all([
      prisma.reimbursementRequest.count({
        where: { ...where, status: ReimbursementStatus.SUBMITTED },
      }),
      prisma.reimbursementRequest.count({
        where: { ...where, status: ReimbursementStatus.UNDER_REVIEW },
      }),
      prisma.reimbursementRequest.count({
        where: { ...where, status: ReimbursementStatus.APPROVED },
      }),
      prisma.reimbursementRequest.count({
        where: { ...where, status: ReimbursementStatus.PAID },
      }),
      prisma.reimbursementRequest.count({
        where: { ...where, status: ReimbursementStatus.REJECTED },
      }),
      prisma.reimbursementRequest.count({
        where: { ...where, status: ReimbursementStatus.INFO_REQUESTED },
      }),
    ]);

    return {
      submitted,
      underReview,
      approved,
      paid,
      rejected,
      infoRequested,
      totalActive: submitted + underReview + approved + infoRequested,
    };
  }
}

export const reimbursementService = new ReimbursementService();
