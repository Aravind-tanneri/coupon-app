import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { ReimbursementService } from "../../modules/reimbursements/reimbursement.service.js";
import { ReimbursementWorkflow } from "../../modules/whatsapp/workflows/reimbursement.workflow.js";
import { ReimbursementStatus } from "@prisma/client";
import { calculateReimbursement } from "../../modules/reimbursements/calculator.js";

vi.mock("../../lib/prisma.js", () => {
  const store = {
    students: new Map<string, any>(),
    policies: new Map<string, any>(),
    claims: new Map<string, any>(),
    history: new Map<string, any>(),
    payouts: new Map<string, any>(),
    sessions: new Map<string, any>(),
    admins: new Map<string, any>(),
  };

  return {
    _store: store,
    prisma: {
      student: {
        findUnique: vi.fn(async ({ where }) => {
          const s = store.students.get(where.id);
          if (!s) return null;
          return {
            ...s,
            mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
          };
        }),
      },
      reimbursementPolicy: {
        findFirst: vi.fn(async ({ where }) => {
          for (const p of store.policies.values()) {
            if (where.messId && p.messId !== where.messId) continue;
            return p;
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }) => {
          const list: any[] = [];
          for (const p of store.policies.values()) {
            if (where?.messId && p.messId !== where.messId) continue;
            list.push(p);
          }
          return list;
        }),
      },
      reimbursementRequest: {
        create: vi.fn(async ({ data }) => {
          const cl = {
            id: `clm_${Date.now()}_${Math.random()}`,
            version: 1,
            publicRef: `REIMB-${Math.floor(1000 + Math.random() * 9000)}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.claims.set(cl.id, cl);
          return cl;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const cl = store.claims.get(where.id);
          if (!cl) return null;
          return {
            ...cl,
            student: store.students.get(cl.studentId),
            documents: [],
            payments: [],
            statusHistory: Array.from(store.history.values()).filter(
              (h: any) => h.requestId === cl.id,
            ),
          };
        }),
        findFirst: vi.fn(async ({ where }) => {
          for (const cl of store.claims.values()) {
            if (where.studentId && cl.studentId !== where.studentId) continue;
            if (where.status && cl.status !== where.status) continue;
            return {
              ...cl,
              student: store.students.get(cl.studentId),
              documents: [],
              statusHistory: [],
            };
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }) => {
          const results: any[] = [];
          for (const cl of store.claims.values()) {
            if (where?.studentId && cl.studentId !== where.studentId) continue;
            if (where?.messId && cl.messId !== where.messId) continue;
            results.push({
              ...cl,
              student: store.students.get(cl.studentId),
              documents: [],
            });
          }
          return results;
        }),
        update: vi.fn(async ({ where, data }) => {
          const cl = store.claims.get(where.id);
          if (!cl) throw new Error("Claim not found");
          Object.assign(cl, data, { version: (cl.version || 1) + 1 });
          return cl;
        }),
      },
      reimbursementStatusHistory: {
        create: vi.fn(async ({ data }) => {
          const h = { id: `hist_${Date.now()}_${Math.random()}`, ...data, createdAt: new Date() };
          store.history.set(h.id, h);
          return h;
        }),
        findMany: vi.fn(async ({ where }) => {
          return Array.from(store.history.values()).filter(
            (h: any) => h.requestId === where.requestId,
          );
        }),
      },
      reimbursementPayment: {
        create: vi.fn(async ({ data }) => {
          const p = { id: `pay_${Date.now()}`, ...data, createdAt: new Date() };
          store.payouts.set(p.id, p);
          return p;
        }),
        findFirst: vi.fn(async () => null),
      },
      payoutRecord: {
        create: vi.fn(async ({ data }) => {
          const p = { id: `pay_${Date.now()}`, ...data, createdAt: new Date() };
          store.payouts.set(p.id, p);
          return p;
        }),
        findFirst: vi.fn(async () => null),
      },
      notification: {
        create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      },
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === "function") return cb(prisma);
        return Promise.all(cb);
      }),
    },
  };
});

vi.mock("../../modules/audit/audit.service.js", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue({ id: "audit-ok" }),
  },
}));

describe("E2E Scenario 2: Reimbursement Claim Lifecycle (§23.2, §26)", () => {
  let reimbursementService: ReimbursementService;
  let reimbursementWorkflow: ReimbursementWorkflow;

  const testStudent = {
    id: "stud-reimb-e2e",
    rollNo: "2024ME042",
    name: "Vikram Malhotra",
    email: "vikram@campus.edu",
    department: "Mechanical Engineering",
    messId: "mess-akshaya",
  };

  const testPolicy = {
    id: "pol-akshaya-standard",
    messId: "mess-akshaya",
    dailyRatePaise: 13100, // ₹131.00/day
    minAbsenceDays: 4, // > 4 counted days required (>= 5)
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    claimDeadlineDays: 30,
    maxAbsenceDays: 30,
    documentRequired: false,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = (await import("../../lib/prisma.js")) as any;
    _store.students.clear();
    _store.policies.clear();
    _store.claims.clear();
    _store.history.clear();
    _store.payouts.clear();

    _store.students.set(testStudent.id, testStudent);
    _store.policies.set(testPolicy.id, testPolicy);

    reimbursementService = new ReimbursementService();
    reimbursementWorkflow = new ReimbursementWorkflow();
  });

  it("completes full lifecycle: Calculate (10->17 Oct) -> Submit -> Admin Review & Approve -> Mark Paid -> Check Status", async () => {
    const { _store } = (await import("../../lib/prisma.js")) as any;

    // 1. Authoritative calculation verification:
    // 10 Oct to 17 Oct: departure & return days excluded -> 6 counted days @ ₹131 = ₹786.00 (78600 paise)
    const calc = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-17",
      today: "2026-10-18",
      policies: [
        {
          id: testPolicy.id,
          messId: testPolicy.messId,
          dailyRatePaise: testPolicy.dailyRatePaise,
          minAbsenceDays: testPolicy.minAbsenceDays,
          effectiveFrom: "2026-01-01",
          effectiveUntil: null,
          claimDeadlineDays: testPolicy.claimDeadlineDays,
          maxAbsenceDays: testPolicy.maxAbsenceDays,
        },
      ],
    });

    expect(calc.eligible).toBe(true);
    expect(calc.countedDays).toBe(6);
    expect(calc.claimablePaise).toBe(78600);

    // 2. Student drafts & submits claim via ReimbursementService
    const draft = await reimbursementService.saveDraft(testStudent.id, {
      startDate: "2026-10-10",
      endDate: "2026-10-17",
      reason: "Family wedding and sanctioned college festival absence",
      payoutDetails: JSON.stringify({
        accountNumber: "912345678901",
        ifscCode: "SBIN0001234",
        beneficiaryName: "Vikram Malhotra",
      }),
    });

    expect(draft.id).toBeDefined();
    expect(draft.status).toBe(ReimbursementStatus.DRAFT);
    expect(draft.countedDays).toBe(6);
    expect(draft.claimedAmountPaise).toBe(78600);

    const createdClaim = await reimbursementService.submitClaim(testStudent.id, draft.id);

    expect(createdClaim.id).toBeDefined();
    expect(createdClaim.status).toBe(ReimbursementStatus.SUBMITTED);
    expect(createdClaim.countedDays).toBe(6);
    expect(createdClaim.claimedAmountPaise).toBe(78600);
    expect(createdClaim.version).toBe(2);

    // 3. Admin starts review
    const adminReviewer = "admin-reviewer-01";
    const underReviewClaim = await reimbursementService.startReview(
      createdClaim.id,
      adminReviewer,
      2, // expectedVersion
    );
    expect(underReviewClaim.status).toBe(ReimbursementStatus.UNDER_REVIEW);
    expect(underReviewClaim.version).toBe(3);

    // 4. Admin approves claim (full amount ₹786)
    const approvedClaim = await reimbursementService.approveClaim(createdClaim.id, adminReviewer, {
      version: 3,
      approvedAmountPaise: 78600,
      remarks: "Verified festival sanction letter; approved in full.",
    });
    expect(approvedClaim.status).toBe(ReimbursementStatus.APPROVED);
    expect(approvedClaim.approvedAmountPaise).toBe(78600);
    expect(approvedClaim.version).toBe(4);

    // 5. Finance admin records payment
    const financeStaff = "finance-admin-01";
    const paymentRecord = await reimbursementService.recordPayment(createdClaim.id, financeStaff, {
      reference: "UTR-BANK-20261029-998811",
      amountPaise: 78600,
      method: "BANK_TRANSFER",
      paidAt: new Date().toISOString(),
      note: "Disbursed via SBI corporate banking",
    });

    expect(paymentRecord.reference).toBe("UTR-BANK-20261029-998811");
    expect(paymentRecord.amountPaise).toBe(78600);

    // Check claim status updated to PAID
    const paidClaim = _store.claims.get(createdClaim.id);
    expect(paidClaim.status).toBe(ReimbursementStatus.PAID);

    // 6. Student queries status on WhatsApp
    const statusQuery = await reimbursementWorkflow.listMyClaims(testStudent.id);
    expect(statusQuery.text).toContain("My Reimbursement Claims");
    expect(statusQuery.text).toContain("₹786.00");
    expect(statusQuery.text).toContain("Paid");
  });
});
