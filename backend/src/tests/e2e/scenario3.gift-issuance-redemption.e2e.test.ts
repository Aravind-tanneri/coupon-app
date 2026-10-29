import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { GiftService } from "../../modules/gifts/gift.service.js";
import { RedemptionService } from "../../modules/redemptions/redemption.service.js";
import { CouponWorkflow } from "../../modules/whatsapp/workflows/coupon.workflow.js";
import { GiftWhatsAppSender } from "../../modules/whatsapp/workflows/gift.sender.js";
import { EmailOutboxWorker } from "../../modules/notifications/outbox.worker.js";
import { ConsoleEmailProvider } from "../../modules/notifications/email.provider.js";
import { MealType, CouponStatus } from "@prisma/client";
import { getTodayISTString } from "../../lib/dates-ist.js";
import { ConflictError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  const store = {
    students: new Map<string, any>(),
    identities: new Map<string, any>(),
    batches: new Map<string, any>(),
    items: new Map<string, any>(),
    coupons: new Map<string, any>(),
    redemptions: new Map<string, any>(),
    notifications: new Map<string, any>(),
  };

  return {
    _store: store,
    prisma: {
      student: {
        findUnique: vi.fn(async ({ where }) => store.students.get(where.id) || null),
        findMany: vi.fn(async ({ where }) => {
          const res: any[] = [];
          for (const s of store.students.values()) {
            if (where?.id?.in && !where.id.in.includes(s.id)) continue;
            if (where?.messId && s.messId !== where.messId) continue;
            res.push(s);
          }
          return res;
        }),
      },
      mess: {
        findUnique: vi.fn(async ({ where }) => ({
          id: where.id,
          code: "AKSHAYA",
          name: "Akshaya Mess",
        })),
      },
      whatsAppIdentity: {
        findFirst: vi.fn(async ({ where }) => {
          for (const iden of store.identities.values()) {
            if (where.phone && iden.phone === where.phone) return iden;
            if (where.studentId && iden.studentId === where.studentId) return iden;
          }
          return null;
        }),
      },
      giftBatch: {
        create: vi.fn(async ({ data }) => {
          const b = { id: `gb_${Date.now()}`, ...data, createdAt: new Date() };
          store.batches.set(b.id, b);
          return b;
        }),
        findUnique: vi.fn(async ({ where }) => store.batches.get(where.id) || null),
        findFirst: vi.fn(async ({ where }) => {
          for (const b of store.batches.values()) {
            if (where.idempotencyKey && b.idempotencyKey === where.idempotencyKey) return b;
          }
          return null;
        }),
      },
      giftItem: {
        create: vi.fn(async ({ data }) => {
          const item = { id: `gi_${Date.now()}_${Math.random()}`, ...data };
          store.items.set(item.id, item);
          return item;
        }),
        findMany: vi.fn(async ({ where }) => {
          return Array.from(store.items.values()).filter((i: any) => i.batchId === where.batchId);
        }),
        findFirst: vi.fn(async ({ where }) => {
          for (const item of store.items.values()) {
            if (where.couponId && item.couponId === where.couponId) return item;
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const item = store.items.get(where.id);
          if (item) Object.assign(item, data);
          return item;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let count = 0;
          for (const item of store.items.values()) {
            if (where.couponId && item.couponId !== where.couponId) continue;
            if (where.batchId && item.batchId !== where.batchId) continue;
            if (where.studentId && item.studentId !== where.studentId) continue;
            Object.assign(item, data);
            count++;
          }
          return { count };
        }),
      },
      coupon: {
        create: vi.fn(async ({ data }) => {
          const c = { id: `cp_${Date.now()}_${Math.random()}`, ...data, createdAt: new Date() };
          store.coupons.set(c.id, c);
          return c;
        }),
        findFirst: vi.fn(async ({ where }) => {
          for (const c of store.coupons.values()) {
            const matches =
              (!where.shortCode || c.shortCode === where.shortCode) &&
              (!where.tokenHash || c.tokenHash === where.tokenHash) &&
              (!where.id || c.id === where.id) &&
              (!where.studentId || c.studentId === where.studentId);
            if (matches) {
              return {
                ...c,
                student: store.students.get(c.studentId),
                mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
              };
            }
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }) => {
          const res: any[] = [];
          for (const c of store.coupons.values()) {
            if (where?.studentId && c.studentId !== where.studentId) continue;
            if (where?.source && c.source !== where.source) continue;
            if (where?.status) {
              if (typeof where.status === "string" && c.status !== where.status) continue;
              if (where.status.in && !where.status.in.includes(c.status)) continue;
              if (where.status.not && c.status === where.status.not) continue;
            }
            res.push({
              ...c,
              student: store.students.get(c.studentId),
              mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
            });
          }
          return res;
        }),
        findUnique: vi.fn(async ({ where }) => {
          const c = store.coupons.get(where.id);
          if (!c) return null;
          return {
            ...c,
            student: store.students.get(c.studentId),
            mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
          };
        }),
        findUniqueOrThrow: vi.fn(async ({ where }) => {
          const c = store.coupons.get(where.id);
          if (!c) throw new Error("Coupon not found");
          return {
            ...c,
            student: store.students.get(c.studentId),
            mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
          };
        }),
        update: vi.fn(async ({ where, data }) => {
          const c = store.coupons.get(where.id);
          if (c) Object.assign(c, data);
          return c;
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          let count = 0;
          for (const c of store.coupons.values()) {
            if (where.id && c.id !== where.id) continue;
            if (where.status && c.status !== where.status) continue;
            if (where.validDate && c.validDate.getTime() !== where.validDate.getTime()) continue;
            if (where.expiresAt?.gt && !(c.expiresAt > new Date())) continue;
            if (where.messId && c.messId !== where.messId) continue;
            Object.assign(c, data);
            count++;
          }
          return { count };
        }),
      },
      couponRedemption: {
        create: vi.fn(async ({ data }) => {
          const r = { id: `red_${Date.now()}`, ...data };
          store.redemptions.set(r.id, r);
          return r;
        }),
      },
      notification: {
        create: vi.fn(async ({ data }) => {
          const n = {
            id: `notif_${Date.now()}_${Math.random()}`,
            status: "PENDING",
            attempts: 0,
            ...data,
          };
          store.notifications.set(n.id, n);
          return n;
        }),
        createMany: vi.fn(async ({ data }) => {
          for (const d of data) {
            const n = {
              id: `notif_${Date.now()}_${Math.random()}`,
              status: "PENDING",
              attempts: 0,
              ...d,
            };
            store.notifications.set(n.id, n);
          }
          return { count: data.length };
        }),
        findMany: vi.fn(async ({ where }) => {
          const res: any[] = [];
          for (const n of store.notifications.values()) {
            if (where?.channel && n.channel !== where.channel) continue;
            if (where?.status && n.status !== where.status) continue;
            res.push({
              ...n,
              student: store.students.get(n.studentId),
            });
          }
          return res;
        }),
        update: vi.fn(async ({ where, data }) => {
          const n = store.notifications.get(where.id);
          if (n) Object.assign(n, data);
          return n;
        }),
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
    log: vi.fn().mockResolvedValue({ id: "audit-ok" }),
  },
}));

describe("E2E Scenario 3: Gift Issuance, Multi-Channel Delivery, Redemption & Revocation Race (§23.2, §26)", () => {
  let giftBatchService: GiftService;
  let redemptionService: RedemptionService;
  let consoleEmail: ConsoleEmailProvider;
  let couponWorkflow: CouponWorkflow;

  const testStudent = {
    id: "student-gift-e2e-1",
    rollNo: "2024CS088",
    name: "Sneha Reddy",
    email: "sneha.reddy@campus.edu",
    department: "Computer Science",
    messId: "mess-akshaya",
  };

  const testIdentity = {
    id: "identity-gift-e2e-1",
    phone: "+919876543299",
    studentId: testStudent.id,
    verifiedAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = (await import("../../lib/prisma.js")) as any;
    _store.students.clear();
    _store.identities.clear();
    _store.batches.clear();
    _store.items.clear();
    _store.coupons.clear();
    _store.redemptions.clear();
    _store.notifications.clear();

    _store.students.set(testStudent.id, testStudent);
    _store.identities.set(testIdentity.id, testIdentity);

    giftBatchService = new GiftService();
    redemptionService = new RedemptionService();
    consoleEmail = new ConsoleEmailProvider();
    couponWorkflow = new CouponWorkflow();
  });

  it("completes full lifecycle: Admin Issues Batch -> Outbox Delivers Email & WhatsApp -> Student Views on WhatsApp -> Counter Redeems -> Revocation Refused with CANNOT_REVOKE_REDEEMED", async () => {
    const todayStr = getTodayISTString();
    const adminId = "admin-diwali-feast-01";
    const { _store } = (await import("../../lib/prisma.js")) as any;

    // 1. Admin issues Special Dinner Feast Gift Coupon Batch
    const batchResult = await giftBatchService.issueBatch(
      {
        messId: "mess-akshaya",
        message: "Diwali Grand Feast 2026",
        mealDate: todayStr,
        studentIds: [testStudent.id],
        idempotencyKey: "diwali-batch-key-001",
      },
      adminId,
    );

    expect(batchResult.batchId).toBeDefined();
    expect(batchResult.issued).toBe(1);
    expect(batchResult.skippedDuplicate).toBe(0);

    // Verify coupon was created with source GIFT and status ACTIVE
    const coupons = Array.from(_store.coupons.values());
    expect(coupons).toHaveLength(1);
    const giftCoupon = coupons[0] as any;
    expect(giftCoupon.source).toBe("ADMIN_GIFT");
    expect(giftCoupon.status).toBe(CouponStatus.ACTIVE);
    expect(giftCoupon.mealType).toBe(MealType.SPECIAL_DINNER);

    // 2. Outbox processes notifications: Email and WhatsApp
    const emailWorker = new EmailOutboxWorker(consoleEmail);
    const emailResult = await emailWorker.processOutbox();
    expect(emailResult.processed).toBeGreaterThanOrEqual(1);

    const whatsAppSender = new GiftWhatsAppSender();
    const waResult = await whatsAppSender.processOutbox();
    expect(waResult.processed).toBeGreaterThanOrEqual(1);

    // Check sent status in GiftItem
    const giftItem = Array.from(_store.items.values())[0] as any;
    expect(giftItem.emailStatus).toBe("SENT");
    expect(giftItem.whatsappStatus).toBe("SENT");

    // 3. Student views gift coupons on WhatsApp
    const myGiftsReply = await couponWorkflow.listMyGiftCoupons(testStudent.id);
    expect(myGiftsReply.text).toContain("Special Dinner");
    expect(myGiftsReply.text).toContain(giftCoupon.shortCode);
    expect(myGiftsReply.buttons).toBeDefined();
    expect(myGiftsReply.buttons?.[0]?.id).toBe(`SHOW_QR:${giftCoupon.shortCode}`);

    // 4. Student presents code at dining hall counter -> Staff redeems coupon
    const staffId = "staff-scanner-diwali";
    const redeemed = await redemptionService.redeemCoupon({
      shortCode: giftCoupon.shortCode,
      messId: "mess-akshaya",
      staffId,
      skipMealWindowCheck: true,
    });

    expect(redeemed.status).toBe(CouponStatus.REDEEMED);
    expect(redeemed.redeemedById).toBe(staffId);

    // 5. Admin attempts to revoke the redeemed gift coupon -> ATOMIC REVOCATION MUST FAIL
    await expect(
      giftBatchService.revokeGiftCoupon(giftCoupon.id, adminId, "Incorrect distribution attempt"),
    ).rejects.toThrowError(ConflictError);

    await expect(
      giftBatchService.revokeGiftCoupon(giftCoupon.id, adminId, "Incorrect distribution attempt"),
    ).rejects.toMatchObject({
      code: "CANNOT_REVOKE_REDEEMED",
    });

    // Verify coupon remains REDEEMED and was never mutated to REVOKED
    const finalCouponState = _store.coupons.get(giftCoupon.id);
    expect(finalCouponState.status).toBe(CouponStatus.REDEEMED);
  });
});
