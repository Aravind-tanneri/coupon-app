import crypto from "crypto";
import { Prisma, CouponStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, NotFoundError, ConflictError } from "../../lib/errors.js";
import { generateToken, hashToken, generateShortCode } from "../../lib/tokens.js";
import { parseDateIST, getTodayIST, formatDateIST } from "../../lib/dates-ist.js";
import { auditService } from "../audit/audit.service.js";
import {
  IssueGiftBatchInput,
  ListGiftBatchesQuery,
  ResendGiftNotificationsInput,
} from "./gift.schemas.js";

export interface GiftBatchResult {
  batchId: string;
  messId: string;
  mealDate: string;
  message?: string | null;
  totalRequested: number;
  issued: number;
  skippedDuplicate: number;
  failed: number;
  items: Array<{
    id: string;
    studentId: string;
    couponId?: string | null;
    shortCode?: string;
  }>;
}

export class GiftService {
  /**
   * Issues a batch of complimentary special dinner coupons to designated students (§19, §20.1).
   * Transactional, idempotent, deduplicated, and guarded against duplicate issuance.
   */
  async issueBatch(
    input: IssueGiftBatchInput,
    actorId: string,
    ip?: string,
  ): Promise<GiftBatchResult> {
    const totalRequested = input.studentIds.length;

    // 1. Validate date is today or future in IST (§19)
    const targetDate = parseDateIST(input.mealDate);
    const todayIST = getTodayIST();
    if (targetDate.getTime() < todayIST.getTime()) {
      throw new BadRequestError("Gift meal date must be today or in the future");
    }

    // 2. Validate mess exists
    const mess = await prisma.mess.findUnique({
      where: { id: input.messId },
    });
    if (!mess) {
      throw new NotFoundError(`Mess '${input.messId}' not found`);
    }

    // 3. Deduplicate input student array (§19, §20.1)
    const uniqueStudentIds = Array.from(new Set(input.studentIds));
    const inputDuplicateCount = totalRequested - uniqueStudentIds.length;

    // 4. Idempotency check on batch idempotencyKey (§19)
    const idempotencyKey =
      input.idempotencyKey || `gift_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

    const existingBatch = await prisma.giftBatch.findUnique({
      where: { idempotencyKey },
      include: {
        items: true,
      },
    });

    if (existingBatch) {
      // Replaying existing batch: return original summary without re-issuing duplicate coupons
      return this.getBatchSummary(existingBatch.id, totalRequested);
    }

    // 5. Query active students from database
    const validStudents = await prisma.student.findMany({
      where: {
        id: { in: uniqueStudentIds },
        active: true,
      },
      select: {
        id: true,
        rollNo: true,
        name: true,
        email: true,
      },
    });

    const failedCount = uniqueStudentIds.length - validStudents.length;

    // 6. Partial unique check: skip students who already hold a non-revoked gift for that date (§19)
    // (studentId, validDate, mealType) WHERE source='ADMIN_GIFT' AND status<>'REVOKED'
    const existingGifts = await prisma.coupon.findMany({
      where: {
        studentId: { in: validStudents.map((s) => s.id) },
        validDate: targetDate,
        mealType: "SPECIAL_DINNER",
        source: "ADMIN_GIFT",
        status: { not: CouponStatus.REVOKED },
      },
      select: { studentId: true },
    });

    const alreadyGiftedStudentIds = new Set(existingGifts.map((g) => g.studentId));
    const eligibleStudents = validStudents.filter((s) => !alreadyGiftedStudentIds.has(s.id));

    const totalSkippedDuplicates = inputDuplicateCount + alreadyGiftedStudentIds.size;

    // End-of-day expiration in IST (23:59:59.999Z relative to date)
    const dateStr = formatDateIST(targetDate);
    const couponExpiresAt = new Date(`${dateStr}T23:59:59.999Z`);

    // 7. Atomic transaction: create batch, coupons, items, and notification outbox (§19, §20)
    const result = await prisma.$transaction(async (tx) => {
      // Create GiftBatch
      const batch = await tx.giftBatch.create({
        data: {
          messId: input.messId,
          createdById: actorId,
          mealDate: targetDate,
          message: input.message,
          idempotencyKey,
          status: "COMPLETED",
        },
      });

      const itemsCreated: Array<{
        id: string;
        studentId: string;
        couponId: string;
        shortCode: string;
      }> = [];

      for (const student of eligibleStudents) {
        const rawToken = generateToken(16);
        const tokenHash = hashToken(rawToken);
        const shortCode = generateShortCode(8);

        // Create GiftItem row
        const item = await tx.giftItem.create({
          data: {
            batchId: batch.id,
            studentId: student.id,
            emailStatus: "PENDING",
            whatsappStatus: "PENDING",
          },
        });

        // Create Coupon with source=ADMIN_GIFT, mealType=SPECIAL_DINNER
        const coupon = await tx.coupon.create({
          data: {
            messId: input.messId,
            studentId: student.id,
            mealType: "SPECIAL_DINNER",
            validDate: targetDate,
            source: "ADMIN_GIFT",
            status: CouponStatus.ACTIVE,
            tokenHash,
            shortCode,
            giftItemId: item.id,
            expiresAt: couponExpiresAt,
          },
        });

        // Link item to coupon
        await tx.giftItem.update({
          where: { id: item.id },
          data: { couponId: coupon.id },
        });

        // Enqueue notifications (Outbox pattern §20)
        await tx.notification.createMany({
          data: [
            {
              studentId: student.id,
              channel: "EMAIL",
              template: "GIFT_COUPON_EMAIL",
              payload: {
                batchId: batch.id,
                couponId: coupon.id,
                shortCode,
                rawToken,
                mealDate: dateStr,
                message: input.message ?? null,
              },
              status: "PENDING",
            },
            {
              studentId: student.id,
              channel: "WHATSAPP",
              template: "GIFT_COUPON_WHATSAPP",
              payload: {
                batchId: batch.id,
                couponId: coupon.id,
                shortCode,
                rawToken,
                mealDate: dateStr,
                message: input.message ?? null,
              },
              status: "PENDING",
            },
          ],
        });

        itemsCreated.push({
          id: item.id,
          studentId: student.id,
          couponId: coupon.id,
          shortCode,
        });
      }

      return {
        batchId: batch.id,
        itemsCreated,
      };
    });

    // Audit log
    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "GIFT_BATCH_ISSUED",
      entityType: "GiftBatch",
      entityId: result.batchId,
      after: {
        messId: input.messId,
        mealDate: dateStr,
        totalRequested,
        issued: result.itemsCreated.length,
        skippedDuplicate: totalSkippedDuplicates,
        failed: failedCount,
      },
      ip,
    });

    return {
      batchId: result.batchId,
      messId: input.messId,
      mealDate: dateStr,
      message: input.message,
      totalRequested,
      issued: result.itemsCreated.length,
      skippedDuplicate: totalSkippedDuplicates,
      failed: failedCount,
      items: result.itemsCreated,
    };
  }

  /**
   * Helper to retrieve summary of an existing batch (used for idempotent retries).
   */
  async getBatchSummary(batchId: string, originalTotal?: number): Promise<GiftBatchResult> {
    const batch = await prisma.giftBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: {
        items: true,
      },
    });

    const couponIds = batch.items.map((i) => i.couponId).filter((id): id is string => Boolean(id));

    const coupons = await prisma.coupon.findMany({
      where: { id: { in: couponIds } },
      select: { id: true, shortCode: true },
    });
    const codeMap = new Map(coupons.map((c) => [c.id, c.shortCode]));

    const total = originalTotal ?? batch.items.length;
    const issued = batch.items.length;
    const skipped = total > issued ? total - issued : 0;

    return {
      batchId: batch.id,
      messId: batch.messId,
      mealDate: formatDateIST(batch.mealDate),
      message: batch.message,
      totalRequested: total,
      issued,
      skippedDuplicate: skipped,
      failed: 0,
      items: batch.items.map((i) => ({
        id: i.id,
        studentId: i.studentId,
        couponId: i.couponId,
        shortCode: i.couponId ? codeMap.get(i.couponId) : undefined,
      })),
    };
  }

  /**
   * Lists gift batches with pagination, filters, and aggregated redemption statistics (§20.2, §20.5).
   */
  async listBatches(query: ListGiftBatchesQuery) {
    const where: Prisma.GiftBatchWhereInput = {};

    if (query.messId) {
      where.messId = query.messId;
    }

    if (query.startDate || query.endDate) {
      where.mealDate = {};
      if (query.startDate) {
        where.mealDate.gte = parseDateIST(query.startDate);
      }
      if (query.endDate) {
        where.mealDate.lte = parseDateIST(query.endDate);
      }
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const [total, batches] = await prisma.$transaction([
      prisma.giftBatch.count({ where }),
      prisma.giftBatch.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          mess: { select: { id: true, code: true, name: true } },
          items: {
            select: {
              id: true,
              couponId: true,
            },
          },
        },
      }),
    ]);

    // Aggregate coupon statuses for each batch
    const allCouponIds = batches.flatMap((b) =>
      b.items.map((i) => i.couponId).filter((id): id is string => Boolean(id)),
    );

    const coupons = await prisma.coupon.findMany({
      where: { id: { in: allCouponIds } },
      select: { id: true, status: true },
    });

    const statusMap = new Map(coupons.map((c) => [c.id, c.status]));

    const enrichedBatches = batches.map((batch) => {
      let active = 0;
      let redeemed = 0;
      let revoked = 0;

      for (const item of batch.items) {
        if (!item.couponId) continue;
        const status = statusMap.get(item.couponId);
        if (status === CouponStatus.ACTIVE) active++;
        else if (status === CouponStatus.REDEEMED) redeemed++;
        else if (status === CouponStatus.REVOKED) revoked++;
      }

      return {
        id: batch.id,
        messId: batch.messId,
        mess: batch.mess,
        createdById: batch.createdById,
        mealDate: formatDateIST(batch.mealDate),
        message: batch.message,
        idempotencyKey: batch.idempotencyKey,
        status: batch.status,
        createdAt: batch.createdAt,
        counts: {
          total: batch.items.length,
          active,
          redeemed,
          revoked,
        },
      };
    });

    return {
      batches: enrichedBatches,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Retrieves single batch with student details and per-coupon redemption status (§20.2, §20.5).
   */
  async getBatchDetails(batchId: string) {
    const batch = await prisma.giftBatch.findUnique({
      where: { id: batchId },
      include: {
        mess: { select: { id: true, code: true, name: true } },
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) {
      throw new NotFoundError(`Gift batch '${batchId}' not found`);
    }

    const studentIds = batch.items.map((i) => i.studentId);
    const couponIds = batch.items.map((i) => i.couponId).filter((id): id is string => Boolean(id));

    const [students, coupons] = await Promise.all([
      prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          rollNo: true,
          name: true,
          email: true,
          department: true,
        },
      }),
      prisma.coupon.findMany({
        where: { id: { in: couponIds } },
        select: {
          id: true,
          shortCode: true,
          status: true,
          validDate: true,
          mealType: true,
          redeemedAt: true,
          revokedAt: true,
        },
      }),
    ]);

    const studentMap = new Map(students.map((s) => [s.id, s]));
    const couponMap = new Map(coupons.map((c) => [c.id, c]));

    let active = 0;
    let redeemed = 0;
    let revoked = 0;

    const items = batch.items.map((item) => {
      const student = studentMap.get(item.studentId);
      const coupon = item.couponId ? couponMap.get(item.couponId) : null;

      if (coupon?.status === CouponStatus.ACTIVE) active++;
      else if (coupon?.status === CouponStatus.REDEEMED) redeemed++;
      else if (coupon?.status === CouponStatus.REVOKED) revoked++;

      return {
        id: item.id,
        studentId: item.studentId,
        student: student ?? null,
        couponId: item.couponId,
        coupon: coupon
          ? {
              ...coupon,
              validDate: formatDateIST(coupon.validDate),
            }
          : null,
        emailStatus: item.emailStatus,
        whatsappStatus: item.whatsappStatus,
        createdAt: item.createdAt,
      };
    });

    return {
      id: batch.id,
      messId: batch.messId,
      mess: batch.mess,
      createdById: batch.createdById,
      mealDate: formatDateIST(batch.mealDate),
      message: batch.message,
      idempotencyKey: batch.idempotencyKey,
      status: batch.status,
      createdAt: batch.createdAt,
      counts: {
        total: batch.items.length,
        active,
        redeemed,
        revoked,
      },
      items,
    };
  }

  /**
   * Revokes an active gift coupon with atomic guard (§19, §20.4).
   * Refuses revocation if coupon is already REDEEMED.
   */
  async revokeGiftCoupon(couponId: string, actorId: string, reason?: string, ip?: string) {
    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      include: {
        mess: { select: { id: true, code: true, name: true } },
        student: { select: { id: true, rollNo: true, name: true, email: true } },
      },
    });

    if (!coupon) {
      throw new NotFoundError(`Coupon '${couponId}' not found`);
    }

    if (coupon.source !== "ADMIN_GIFT") {
      throw new BadRequestError("Only gift coupons can be revoked through this endpoint");
    }

    // Atomic status transition ACTIVE -> REVOKED (§19, §20.4)
    const now = new Date();
    const updateResult = await prisma.coupon.updateMany({
      where: {
        id: couponId,
        status: CouponStatus.ACTIVE,
      },
      data: {
        status: CouponStatus.REVOKED,
        revokedAt: now,
        revokedById: actorId,
      },
    });

    if (updateResult.count === 0) {
      const current = await prisma.coupon.findUnique({ where: { id: couponId } });
      if (current?.status === CouponStatus.REDEEMED) {
        throw new ConflictError(
          "Cannot revoke an already redeemed coupon",
          "CANNOT_REVOKE_REDEEMED",
          { redeemedAt: current.redeemedAt, redeemedById: current.redeemedById },
        );
      }
      if (current?.status === CouponStatus.REVOKED) {
        throw new ConflictError("Coupon is already revoked", "ALREADY_REVOKED");
      }
      throw new ConflictError(
        `Coupon cannot be revoked in status ${current?.status ?? "UNKNOWN"}`,
        "INVALID_STATE",
      );
    }

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "GIFT_COUPON_REVOKED",
      entityType: "Coupon",
      entityId: couponId,
      before: { status: CouponStatus.ACTIVE },
      after: { status: CouponStatus.REVOKED, reason },
      ip,
    });

    return {
      id: coupon.id,
      status: CouponStatus.REVOKED,
      shortCode: coupon.shortCode,
      revokedAt: now,
      revokedById: actorId,
      reason,
    };
  }

  /**
   * Resends failed or pending notifications for a batch (§19, §20.2).
   * Never re-issues coupons.
   */
  async resendNotifications(
    batchId: string,
    options: ResendGiftNotificationsInput,
    actorId: string,
    ip?: string,
  ) {
    const batch = await prisma.giftBatch.findUnique({
      where: { id: batchId },
      include: {
        items: true,
      },
    });

    if (!batch) {
      throw new NotFoundError(`Gift batch '${batchId}' not found`);
    }

    let itemsToProcess = batch.items;
    if (options.itemId) {
      itemsToProcess = itemsToProcess.filter((i) => i.id === options.itemId);
      if (itemsToProcess.length === 0) {
        throw new NotFoundError(`Gift item '${options.itemId}' not found in batch`);
      }
    }

    const couponIds = itemsToProcess
      .map((i) => i.couponId)
      .filter((id): id is string => Boolean(id));

    const coupons = await prisma.coupon.findMany({
      where: { id: { in: couponIds } },
      select: { id: true, shortCode: true, status: true },
    });
    const couponMap = new Map(coupons.map((c) => [c.id, c]));

    const dateStr = formatDateIST(batch.mealDate);
    let enqueuedCount = 0;

    for (const item of itemsToProcess) {
      if (!item.couponId) continue;
      const coupon = couponMap.get(item.couponId);
      if (!coupon || coupon.status === CouponStatus.REVOKED) continue;

      const notificationsToCreate: Prisma.NotificationCreateManyInput[] = [];

      if (
        (options.channel === "ALL" || options.channel === "EMAIL") &&
        (item.emailStatus === "FAILED" || item.emailStatus === "PENDING")
      ) {
        notificationsToCreate.push({
          studentId: item.studentId,
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: batch.id,
            couponId: item.couponId,
            shortCode: coupon.shortCode,
            mealDate: dateStr,
            message: batch.message,
            isResend: true,
          },
          status: "PENDING",
        });
      }

      if (
        (options.channel === "ALL" || options.channel === "WHATSAPP") &&
        (item.whatsappStatus === "FAILED" || item.whatsappStatus === "PENDING")
      ) {
        notificationsToCreate.push({
          studentId: item.studentId,
          channel: "WHATSAPP",
          template: "GIFT_COUPON_WHATSAPP",
          payload: {
            batchId: batch.id,
            couponId: item.couponId,
            shortCode: coupon.shortCode,
            mealDate: dateStr,
            message: batch.message,
            isResend: true,
          },
          status: "PENDING",
        });
      }

      if (notificationsToCreate.length > 0) {
        await prisma.notification.createMany({
          data: notificationsToCreate,
        });
        enqueuedCount += notificationsToCreate.length;
      }
    }

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "GIFT_NOTIFICATIONS_RESENT",
      entityType: "GiftBatch",
      entityId: batchId,
      after: {
        enqueuedCount,
        channel: options.channel,
      },
      ip,
    });

    return {
      batchId,
      enqueuedCount,
    };
  }
}

export const giftService = new GiftService();
