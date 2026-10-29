import { describe, it, expect, vi, beforeEach } from "vitest";
import { reimbursementService } from "./reimbursement.service.js";
import { policyService } from "./policy.service.js";
import { prisma } from "../../lib/prisma.js";
import { ConflictError, BusinessRuleError, StaleVersionError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      student: {
        findUnique: vi.fn(),
      },
      reimbursementPolicy: {
        findMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      reimbursementRequest: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      reimbursementStatusHistory: {
        create: vi.fn(),
      },
      reimbursementPayment: {
        create: vi.fn(),
      },
      notification: {
        create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      },
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === "function") {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
    },
  };
});

vi.mock("../audit/audit.service.js", () => {
  return {
    auditService: {
      log: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
});

describe("Reimbursement Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PolicyService", () => {
    it("creates a new policy and closes previous active policy", async () => {
      vi.mocked(prisma.reimbursementPolicy.findMany).mockResolvedValue([
        {
          id: "pol-old",
          messId: "akshaya",
          dailyRatePaise: 13100,
          minAbsenceDays: 4,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveUntil: null,
          claimDeadlineDays: 30,
          maxAbsenceDays: null,
          documentRequired: false,
          createdById: "admin-1",
          createdAt: new Date(),
        },
      ]);

      vi.mocked(prisma.reimbursementPolicy.update).mockResolvedValue({
        id: "pol-old",
        effectiveUntil: new Date("2026-10-31T00:00:00.000Z"),
      } as unknown as import("@prisma/client").ReimbursementPolicy);

      vi.mocked(prisma.reimbursementPolicy.create).mockResolvedValue({
        id: "pol-new",
        messId: "akshaya",
        dailyRatePaise: 14500,
        minAbsenceDays: 4,
        effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
        effectiveUntil: null,
        claimDeadlineDays: 30,
        maxAbsenceDays: null,
        documentRequired: false,
        createdById: "admin-1",
        createdAt: new Date(),
      });

      const res = await policyService.createPolicy(
        {
          messId: "akshaya",
          dailyRatePaise: 14500,
          minAbsenceDays: 4,
          effectiveFrom: "2026-11-01",
          claimDeadlineDays: 30,
          documentRequired: false,
        },
        "admin-1",
      );

      expect(res.id).toBe("pol-new");
      expect(prisma.reimbursementPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pol-old" },
        }),
      );
    });

    it("rejects policy when effectiveFrom overlaps with an existing newer policy", async () => {
      vi.mocked(prisma.reimbursementPolicy.findMany).mockResolvedValue([
        {
          id: "pol-1",
          messId: "akshaya",
          dailyRatePaise: 14000,
          minAbsenceDays: 4,
          effectiveFrom: new Date("2026-12-01T00:00:00.000Z"),
          effectiveUntil: null,
          claimDeadlineDays: 30,
          maxAbsenceDays: null,
          documentRequired: false,
          createdById: "admin-1",
          createdAt: new Date(),
        },
      ]);

      await expect(
        policyService.createPolicy(
          {
            messId: "akshaya",
            dailyRatePaise: 13500,
            minAbsenceDays: 4,
            effectiveFrom: "2026-11-01", // Earlier than pol-1
            claimDeadlineDays: 30,
            documentRequired: false,
          },
          "admin-1",
        ),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("ReimbursementService Claim Lifecycle", () => {
    it("creates draft claim with server-calculated amounts", async () => {
      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-1",
        messId: "akshaya",
        rollNo: "2024CS01",
        name: "Alice",
        department: "CSE",
        email: "alice@example.com",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
      } as unknown as import("@prisma/client").Student & { mess: import("@prisma/client").Mess });

      vi.mocked(prisma.reimbursementPolicy.findMany).mockResolvedValue([
        {
          id: "pol-1",
          messId: "akshaya",
          dailyRatePaise: 13100,
          minAbsenceDays: 4,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveUntil: null,
          claimDeadlineDays: 30,
          maxAbsenceDays: null,
          documentRequired: false,
          createdById: "admin-1",
          createdAt: new Date(),
        },
      ]);

      vi.mocked(prisma.reimbursementRequest.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reimbursementRequest.findFirst).mockResolvedValue(null);

      vi.mocked(prisma.reimbursementRequest.create).mockResolvedValue({
        id: "claim-draft",
        publicRef: "CLM-2026-TEST1",
        messId: "akshaya",
        studentId: "stud-1",
        startDate: new Date("2026-10-10T00:00:00.000Z"),
        endDate: new Date("2026-10-17T00:00:00.000Z"),
        countedDays: 6,
        rateAtClaimPaise: 13100,
        claimedAmountPaise: 78600,
        status: "DRAFT",
        version: 1,
      } as unknown as import("@prisma/client").ReimbursementRequest);

      const draft = await reimbursementService.saveDraft("stud-1", {
        startDate: "2026-10-10",
        endDate: "2026-10-17",
        reason: "Attending technical conference",
      });

      expect(draft.id).toBe("claim-draft");
      expect(draft.status).toBe("DRAFT");
      expect(prisma.reimbursementRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            claimedAmountPaise: 78600,
            countedDays: 6,
          }),
        }),
      );
    });

    it("submits draft claim successfully and creates status history", async () => {
      vi.mocked(prisma.reimbursementRequest.findFirst).mockResolvedValue({
        id: "claim-draft",
        publicRef: "CLM-2026-TEST1",
        messId: "akshaya",
        studentId: "stud-1",
        startDate: new Date("2026-10-10T00:00:00.000Z"),
        endDate: new Date("2026-10-17T00:00:00.000Z"),
        status: "DRAFT",
        version: 1,
      } as unknown as import("@prisma/client").ReimbursementRequest);

      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-1",
        messId: "akshaya",
        mess: { id: "akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
      } as unknown as import("@prisma/client").Student & { mess: import("@prisma/client").Mess });

      vi.mocked(prisma.reimbursementPolicy.findMany).mockResolvedValue([
        {
          id: "pol-1",
          messId: "akshaya",
          dailyRatePaise: 13100,
          minAbsenceDays: 4,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveUntil: null,
          claimDeadlineDays: 30,
          maxAbsenceDays: null,
          documentRequired: false,
          createdById: "admin-1",
          createdAt: new Date(),
        },
      ]);
      vi.mocked(prisma.reimbursementRequest.findMany).mockResolvedValue([]);

      vi.mocked(prisma.reimbursementRequest.update).mockResolvedValue({
        id: "claim-draft",
        status: "SUBMITTED",
        version: 2,
        claimedAmountPaise: 78600,
        countedDays: 6,
      } as unknown as import("@prisma/client").ReimbursementRequest);

      const submitted = await reimbursementService.submitClaim("stud-1", "claim-draft");
      expect(submitted.status).toBe("SUBMITTED");
      expect(prisma.reimbursementStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: "DRAFT",
            toStatus: "SUBMITTED",
          }),
        }),
      );
    });

    it("enforces approval constraints: cannot approve more than claimed amount", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-1",
        messId: "akshaya",
        claimedAmountPaise: 78600,
        status: "UNDER_REVIEW",
        version: 2,
      } as unknown as import("@prisma/client").ReimbursementRequest);

      await expect(
        reimbursementService.approveClaim("claim-1", "admin-1", {
          approvedAmountPaise: 80000, // > 78600
          version: 2,
        }),
      ).rejects.toThrowError(BusinessRuleError);
    });

    it("requires mandatory remarks when approving less than claimed amount", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-1",
        messId: "akshaya",
        claimedAmountPaise: 78600,
        status: "UNDER_REVIEW",
        version: 2,
      } as unknown as import("@prisma/client").ReimbursementRequest);

      await expect(
        reimbursementService.approveClaim("claim-1", "admin-1", {
          approvedAmountPaise: 60000,
          remarks: "", // Missing reduction remark
          version: 2,
        }),
      ).rejects.toThrowError(/Mandatory remarks/);
    });

    it("detects stale versions and throws StaleVersionError", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-1",
        status: "UNDER_REVIEW",
        version: 5,
        claimedAmountPaise: 78600,
      } as unknown as import("@prisma/client").ReimbursementRequest);

      await expect(
        reimbursementService.approveClaim("claim-1", "admin-1", {
          approvedAmountPaise: 78600,
          version: 4, // Stale version
        }),
      ).rejects.toThrowError(StaleVersionError);
    });

    it("records payment and moves claim to PAID once fully settled", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-1",
        messId: "akshaya",
        claimedAmountPaise: 78600,
        approvedAmountPaise: 78600,
        status: "APPROVED",
        payments: [],
      } as unknown as import("@prisma/client").ReimbursementRequest & {
        payments: import("@prisma/client").ReimbursementPayment[];
      });

      vi.mocked(prisma.reimbursementPayment.create).mockResolvedValue({
        id: "pay-1",
        requestId: "claim-1",
        amountPaise: 78600,
        method: "UPI",
        reference: "UPI/2026/891238",
        paidAt: new Date(),
        recordedById: "admin-1",
        status: "SUCCEEDED",
        note: null,
        createdAt: new Date(),
      });

      const payment = await reimbursementService.recordPayment("claim-1", "admin-1", {
        amountPaise: 78600,
        method: "UPI",
        reference: "UPI/2026/891238",
      });

      expect(payment.id).toBe("pay-1");
      expect(prisma.reimbursementRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PAID",
          }),
        }),
      );
    });

    it("blocks overpayment beyond approved amount", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValue({
        id: "claim-1",
        messId: "akshaya",
        claimedAmountPaise: 78600,
        approvedAmountPaise: 78600,
        status: "APPROVED",
        payments: [
          {
            id: "pay-1",
            amountPaise: 50000,
            status: "SUCCEEDED",
          } as unknown as import("@prisma/client").ReimbursementPayment,
        ],
      } as unknown as import("@prisma/client").ReimbursementRequest & {
        payments: import("@prisma/client").ReimbursementPayment[];
      });

      await expect(
        reimbursementService.recordPayment("claim-1", "admin-1", {
          amountPaise: 30000, // 50000 + 30000 = 80000 > 78600
          method: "BANK_TRANSFER",
          reference: "NEFT/99812",
        }),
      ).rejects.toThrowError(/would exceed approved claim total/);
    });
  });
});
