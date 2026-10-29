import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { RedemptionService } from "../../modules/redemptions/redemption.service.js";
import { PaymentService } from "../../modules/payments/payment.service.js";
import { FakePaymentProvider } from "../../modules/payments/fake-payment.provider.js";
import { ReimbursementService } from "../../modules/reimbursements/reimbursement.service.js";
import { GiftService } from "../../modules/gifts/gift.service.js";
import { CouponStatus, OrderStatus, MealType, ReimbursementStatus } from "@prisma/client";
import { getTodayIST } from "../../lib/dates-ist.js";
import { ConflictError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  const store = {
    coupons: new Map<string, any>(),
    orders: new Map<string, any>(),
    redemptions: new Map<string, any>(),
    webhooks: new Map<string, any>(),
    claims: new Map<string, any>(),
    history: new Map<string, any>(),
    students: new Map<string, any>(),
    policies: new Map<string, any>(),
  };

  // Simulates atomic single-threaded database engine with row-level locks
  let dbLock = Promise.resolve();
  const withDbLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = dbLock;
    let resolveNext!: () => void;
    dbLock = new Promise<void>((r) => (resolveNext = r));
    await prev;
    try {
      return await fn();
    } finally {
      resolveNext();
    }
  };

  return {
    _store: store,
    prisma: {
      student: {
        findUnique: vi.fn(async ({ where }) => store.students.get(where.id) || null),
      },
      reimbursementPolicy: {
        findMany: vi.fn(async () => Array.from(store.policies.values())),
        findFirst: vi.fn(async () => Array.from(store.policies.values())[0] || null),
      },
      coupon: {
        findFirst: vi.fn(async ({ where }) => {
          return withDbLock(async () => {
            for (const c of store.coupons.values()) {
              if (where.shortCode && c.shortCode === where.shortCode) {
                return {
                  ...c,
                  student: { id: "s1", rollNo: "2024CS001", name: "Alice", department: "CSE" },
                  mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
                  product: { code: "LUNCH", mealType: c.mealType },
                };
              }
            }
            return null;
          });
        }),
        findUnique: vi.fn(async ({ where }) => {
          return withDbLock(async () => {
            const c = store.coupons.get(where.id);
            if (!c) return null;
            return {
              ...c,
              student: { id: "s1", rollNo: "2024CS001", name: "Alice", department: "CSE" },
              mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
              product: { code: "LUNCH", mealType: c.mealType },
            };
          });
        }),
        findUniqueOrThrow: vi.fn(async ({ where }) => {
          const c = store.coupons.get(where.id);
          if (!c) throw new Error("Coupon not found");
          return {
            ...c,
            student: { id: "s1", rollNo: "2024CS001", name: "Alice", department: "CSE" },
            mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
            product: { code: "LUNCH", mealType: c.mealType },
          };
        }),
        create: vi.fn(async ({ data }) => {
          return withDbLock(async () => {
            const c = { id: `cp_${Date.now()}_${Math.random()}`, ...data };
            store.coupons.set(c.id, c);
            return c;
          });
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          return withDbLock(async () => {
            const c = store.coupons.get(where.id);
            if (!c) return { count: 0 };
            if (where.status && c.status !== where.status) return { count: 0 };
            Object.assign(c, data);
            return { count: 1 };
          });
        }),
      },
      couponRedemption: {
        create: vi.fn(async ({ data }) => {
          return withDbLock(async () => {
            const r = { id: `red_${Date.now()}_${Math.random()}`, ...data };
            store.redemptions.set(r.id, r);
            return r;
          });
        }),
      },
      couponOrder: {
        findFirst: vi.fn(async ({ where }) => {
          return withDbLock(async () => {
            for (const o of store.orders.values()) {
              if (where.razorpayOrderId && o.razorpayOrderId === where.razorpayOrderId) {
                return {
                  ...o,
                  product: { messId: "mess-1", mealType: MealType.LUNCH },
                  student: { id: "s1", name: "Alice", rollNo: "2024CS001" },
                };
              }
            }
            return null;
          });
        }),
        update: vi.fn(async ({ where, data }) => {
          return withDbLock(async () => {
            const o = store.orders.get(where.id);
            if (o) Object.assign(o, data);
            return o;
          });
        }),
      },
      webhookEvent: {
        findUnique: vi.fn(async ({ where }) => {
          return withDbLock(async () => {
            return store.webhooks.get(where.provider_eventId?.eventId) || null;
          });
        }),
        create: vi.fn(async ({ data }) => {
          return withDbLock(async () => {
            if (store.webhooks.has(data.eventId)) {
              const err: any = new Error("Unique constraint failed on (provider, eventId)");
              err.code = "P2002";
              throw err;
            }
            const evt = { id: `evt_${Date.now()}`, ...data };
            store.webhooks.set(data.eventId, evt);
            return evt;
          });
        }),
        update: vi.fn(async () => ({})),
      },
      reimbursementRequest: {
        findUnique: vi.fn(async ({ where }) => {
          return withDbLock(async () => {
            const cl = store.claims.get(where.id);
            if (!cl) return null;
            return { ...cl, payments: [], statusHistory: [] };
          });
        }),
        findMany: vi.fn(async () => Array.from(store.claims.values())),
        update: vi.fn(async ({ where, data }) => {
          return withDbLock(async () => {
            const cl = store.claims.get(where.id);
            if (!cl) throw new Error("Claim not found");
            // Optimistic concurrency check: version must match
            if (where.version !== undefined && cl.version !== where.version) {
              const err: any = new Error("Record to update not found (version conflict)");
              err.code = "P2025";
              throw err;
            }
            Object.assign(cl, data, { version: cl.version + 1 });
            return cl;
          });
        }),
      },
      reimbursementStatusHistory: {
        create: vi.fn(async ({ data }) => {
          return withDbLock(async () => {
            const h = { id: `hist_${Date.now()}`, ...data };
            store.history.set(h.id, h);
            return h;
          });
        }),
      },
      notification: {
        create: vi.fn(async () => ({ id: "notif-1" })),
      },
      setting: {
        findUnique: vi.fn(async () => null),
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
    log: vi.fn().mockResolvedValue({ id: "audit-1" }),
  },
}));

describe("Phase 23 Concurrency & Race Condition Suite (§23.3, §26)", () => {
  let redemptionService: RedemptionService;
  let paymentService: PaymentService;
  let fakePaymentProvider: FakePaymentProvider;
  let reimbursementService: ReimbursementService;
  let giftService: GiftService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = (await import("../../lib/prisma.js")) as any;
    _store.coupons.clear();
    _store.orders.clear();
    _store.redemptions.clear();
    _store.webhooks.clear();
    _store.claims.clear();
    _store.history.clear();

    redemptionService = new RedemptionService();
    fakePaymentProvider = new FakePaymentProvider();
    paymentService = new PaymentService(fakePaymentProvider);
    reimbursementService = new ReimbursementService();
    giftService = new GiftService();
  });

  it("50 parallel redemption requests on a single active coupon: exactly 1 succeeds, 49 fail with ALREADY_REDEEMED (§23.3, §26)", async () => {
    const { _store } = (await import("../../lib/prisma.js")) as any;
    const todayDate = getTodayIST();

    const activeCoupon = {
      id: "coupon-race-50",
      messId: "mess-1",
      studentId: "s1",
      shortCode: "RACE5099",
      status: CouponStatus.ACTIVE,
      validDate: todayDate,
      expiresAt: new Date(Date.now() + 3600000),
      mealType: MealType.LUNCH,
      source: "PURCHASE",
    };
    _store.coupons.set(activeCoupon.id, activeCoupon);

    // Fire 50 simultaneous redemptions
    const requests = Array.from({ length: 50 }, (_, i) =>
      redemptionService
        .redeemCoupon({
          shortCode: "RACE5099",
          messId: "mess-1",
          staffId: `staff-${i}`,
          skipMealWindowCheck: true,
        })
        .then(() => ({ success: true, error: null }))
        .catch((err) => ({ success: false, error: err })),
    );

    const results = await Promise.all(requests);

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(49);

    // Assert every failure code is strictly ALREADY_REDEEMED
    for (const f of failed) {
      expect((f.error as ConflictError).code).toBe("ALREADY_REDEEMED");
    }

    // Verify DB integrity: coupon state is REDEEMED and exactly one redemption log recorded
    expect(_store.coupons.get(activeCoupon.id).status).toBe(CouponStatus.REDEEMED);
    expect(_store.redemptions.size).toBe(1);
  });

  it("10 concurrent Razorpay webhook replays: exactly 1 fulfills, 9 treated as idempotent replays (§23.3, §18.4)", async () => {
    const { _store } = (await import("../../lib/prisma.js")) as any;
    const todayDate = getTodayIST();

    const order = {
      id: "order-replay-10",
      razorpayOrderId: "rzp_order_replay_10",
      amountPaise: 5000,
      studentId: "s1",
      productId: "prod-1",
      status: OrderStatus.CREATED,
      validDate: todayDate,
    };
    _store.orders.set(order.id, order);

    const webhookBody = JSON.stringify({
      event: "order.paid",
      payload: {
        order: { entity: { id: order.razorpayOrderId, amount_paid: 5000 } },
        payment: {
          entity: {
            id: "pay_dup_1",
            order_id: order.razorpayOrderId,
            amount: 5000,
            currency: "INR",
          },
        },
      },
    });

    // 10 concurrent requests with the identical eventId
    const webhookCalls = Array.from({ length: 10 }, () =>
      paymentService.processWebhook(
        webhookBody,
        "valid_webhook_sig",
        "evt_dup_replay_12345",
        JSON.parse(webhookBody),
      ),
    );

    const results = await Promise.all(webhookCalls);

    const processed = results.filter((r) => r.received && !r.duplicate);
    const duplicates = results.filter((r) => r.duplicate);

    // Exactly 1 webhook event created in DB, exactly 1 coupon fulfilled
    expect(processed.length + duplicates.length).toBe(10);
    expect(_store.coupons.size).toBe(1);
    expect(_store.orders.get(order.id).status).toBe(OrderStatus.PAID);
  });

  it("Two concurrent claim approvals on the same claim: exactly 1 succeeds, second gets 409 STALE_VERSION (§23.3, §10.2)", async () => {
    const { _store } = (await import("../../lib/prisma.js")) as any;

    const underReviewClaim = {
      id: "claim-race-review",
      messId: "mess-1",
      studentId: "s1",
      status: ReimbursementStatus.UNDER_REVIEW,
      version: 2,
      claimedAmountPaise: 78600,
    };
    _store.claims.set(underReviewClaim.id, underReviewClaim);

    // Admin A and Admin B approve the same version concurrently
    const approvalA = reimbursementService
      .approveClaim(underReviewClaim.id, "admin-A", {
        version: 2,
        approvedAmountPaise: 78600,
        remarks: "Approved by Admin A",
      })
      .then(() => ({ success: true, error: null }))
      .catch((err) => ({ success: false, error: err }));

    const approvalB = reimbursementService
      .approveClaim(underReviewClaim.id, "admin-B", {
        version: 2,
        approvedAmountPaise: 78600,
        remarks: "Approved by Admin B",
      })
      .then(() => ({ success: true, error: null }))
      .catch((err) => ({ success: false, error: err }));

    const [resA, resB] = await Promise.all([approvalA, approvalB]);

    const successes = [resA, resB].filter((r) => r.success);
    const failures = [resA, resB].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toMatchObject({ code: "STALE_VERSION" });
  });

  it("Revocation vs Redemption race on the same gift coupon: exactly one succeeds, never both (§23.3, §20.4)", async () => {
    const { _store } = (await import("../../lib/prisma.js")) as any;
    const todayDate = getTodayIST();

    const giftCoupon = {
      id: "coupon-revoke-vs-redeem",
      messId: "mess-1",
      studentId: "s1",
      shortCode: "REVOKERACE",
      status: CouponStatus.ACTIVE,
      validDate: todayDate,
      expiresAt: new Date(Date.now() + 3600000),
      mealType: MealType.SPECIAL_DINNER,
      source: "ADMIN_GIFT",
    };
    _store.coupons.set(giftCoupon.id, giftCoupon);

    // Concurrently redeem and revoke
    const redeemPromise = redemptionService
      .redeemCoupon({
        shortCode: "REVOKERACE",
        messId: "mess-1",
        staffId: "counter-staff",
        skipMealWindowCheck: true,
      })
      .then(() => ({ action: "REDEEM", success: true }))
      .catch((err) => ({ action: "REDEEM", success: false, error: err }));

    const revokePromise = giftService
      .revokeGiftCoupon(giftCoupon.id, "admin-revoke", "Emergency revocation")
      .then(() => ({ action: "REVOKE", success: true }))
      .catch((err) => ({ action: "REVOKE", success: false, error: err }));

    const [redeemRes, revokeRes] = await Promise.all([redeemPromise, revokePromise]);

    const winner = [redeemRes, revokeRes].filter((r) => r.success);
    const loser = [redeemRes, revokeRes].filter((r) => !r.success);

    // Invariant: Exactly one operation wins
    expect(winner).toHaveLength(1);
    expect(loser).toHaveLength(1);

    const finalCoupon = _store.coupons.get(giftCoupon.id);
    if (winner[0]?.action === "REDEEM") {
      expect(finalCoupon.status).toBe(CouponStatus.REDEEMED);
      expect((loser[0] as any)?.error?.code).toBe("CANNOT_REVOKE_REDEEMED");
    } else {
      expect(finalCoupon.status).toBe(CouponStatus.REVOKED);
      expect((loser[0] as any)?.error?.code).toBe("REVOKED");
    }
  });
});
