import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { PaymentService } from "../../modules/payments/payment.service.js";
import { FakePaymentProvider } from "../../modules/payments/fake-payment.provider.js";
import { RedemptionService } from "../../modules/redemptions/redemption.service.js";
import { CouponWorkflow } from "../../modules/whatsapp/workflows/coupon.workflow.js";
import { MealType, OrderStatus, CouponStatus } from "@prisma/client";
import { getTodayIST } from "../../lib/dates-ist.js";
import { generateToken } from "../../lib/tokens.js";

vi.mock("../../lib/prisma.js", () => {
  const store = {
    students: new Map<string, any>(),
    identities: new Map<string, any>(),
    products: new Map<string, any>(),
    orders: new Map<string, any>(),
    coupons: new Map<string, any>(),
    redemptions: new Map<string, any>(),
    webhooks: new Map<string, any>(),
    settings: new Map<string, any>(),
  };

  return {
    _store: store,
    prisma: {
      student: {
        findUnique: vi.fn(async ({ where }) => store.students.get(where.id) || null),
        findFirst: vi.fn(async ({ where }) => {
          for (const s of store.students.values()) {
            if (where.rollNo && s.rollNo === where.rollNo) return s;
          }
          return null;
        }),
      },
      whatsAppIdentity: {
        findFirst: vi.fn(async ({ where }) => {
          for (const iden of store.identities.values()) {
            if (where.phone && iden.phone === where.phone) return iden;
            if (where.studentId && iden.studentId === where.studentId) return iden;
          }
          return null;
        }),
        findUnique: vi.fn(async ({ where }) => store.identities.get(where.id) || null),
      },
      couponProduct: {
        findUnique: vi.fn(async ({ where }) => store.products.get(where.id) || null),
        findFirst: vi.fn(async ({ where }) => {
          for (const p of store.products.values()) {
            if (where.code && p.code === where.code) return p;
          }
          return null;
        }),
      },
      couponOrder: {
        create: vi.fn(async ({ data }) => {
          const ord = { id: `ord_${Date.now()}`, ...data, createdAt: new Date() };
          store.orders.set(ord.id, ord);
          return ord;
        }),
        findUnique: vi.fn(async ({ where }) => {
          if (where.id) return store.orders.get(where.id) || null;
          if (where.orderToken) {
            for (const o of store.orders.values()) {
              if (o.orderToken === where.orderToken) return o;
            }
          }
          return null;
        }),
        findFirst: vi.fn(async ({ where }) => {
          for (const o of store.orders.values()) {
            if (where.razorpayOrderId && o.razorpayOrderId === where.razorpayOrderId) {
              return {
                ...o,
                product: store.products.get(o.productId),
                student: store.students.get(o.studentId),
              };
            }
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }) => {
          const ord = store.orders.get(where.id);
          if (!ord) throw new Error("Order not found");
          Object.assign(ord, data);
          return ord;
        }),
      },
      coupon: {
        create: vi.fn(async ({ data }) => {
          const c = { id: `coup_${Date.now()}_${Math.random()}`, ...data, createdAt: new Date() };
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
                product: store.products.get(c.productId),
                mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
              };
            }
          }
          return null;
        }),
        findUniqueOrThrow: vi.fn(async ({ where }) => {
          const c = store.coupons.get(where.id);
          if (!c) throw new Error("Coupon not found");
          return {
            ...c,
            student: store.students.get(c.studentId),
            product: store.products.get(c.productId),
            mess: { id: "mess-akshaya", code: "AKSHAYA", name: "Akshaya Mess" },
          };
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
      webhookEvent: {
        findUnique: vi.fn(async ({ where }) => store.webhooks.get(where.provider_eventId?.eventId)),
        create: vi.fn(async ({ data }) => {
          const evt = { id: `evt_${Date.now()}`, ...data };
          store.webhooks.set(data.eventId, evt);
          return evt;
        }),
        update: vi.fn(async ({ where, data }) => {
          const evt = store.webhooks.get(where.id);
          if (evt) Object.assign(evt, data);
          return evt;
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

describe("E2E Scenario 1: Student Purchase & Counter Redemption Workflow (§23.2, §26)", () => {
  let fakePaymentProvider: FakePaymentProvider;
  let paymentService: PaymentService;
  let redemptionService: RedemptionService;
  let couponWorkflow: CouponWorkflow;

  const testStudent = {
    id: "student-e2e-1",
    rollNo: "2024CS001",
    name: "Rohan Verma",
    email: "rohan@campus.edu",
    department: "Computer Science",
    messId: "mess-akshaya",
  };

  const testIdentity = {
    id: "identity-e2e-1",
    phone: "+919876543210",
    studentId: testStudent.id,
    verifiedAt: new Date(),
  };

  const dinnerProduct = {
    id: "prod-dinner-1",
    code: "EXTRA_DINNER",
    mealType: MealType.DINNER,
    pricePaise: 6500, // ₹65.00
    messId: "mess-akshaya",
    isActive: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = (await import("../../lib/prisma.js")) as any;
    _store.students.clear();
    _store.identities.clear();
    _store.products.clear();
    _store.orders.clear();
    _store.coupons.clear();
    _store.redemptions.clear();
    _store.webhooks.clear();
    _store.settings.clear();

    // Seed test fixtures
    _store.students.set(testStudent.id, testStudent);
    _store.identities.set(testIdentity.id, testIdentity);
    _store.products.set(dinnerProduct.id, dinnerProduct);

    fakePaymentProvider = new FakePaymentProvider();
    paymentService = new PaymentService(fakePaymentProvider);
    couponWorkflow = new CouponWorkflow();
    redemptionService = new RedemptionService();
  });

  it("completes full lifecycle: Buy Coupon -> Pay Razorpay Webhook -> Receive QR -> Counter Redeem -> Re-redemption Refused", async () => {
    const todayDate = getTodayIST();

    // 1. Student initiates order for Extra Dinner
    const orderToken = generateToken();
    const razorpayOrder = await fakePaymentProvider.createOrder({
      amountPaise: dinnerProduct.pricePaise,
      receipt: `ord_${orderToken.substring(0, 8)}`,
      notes: { studentId: testStudent.id, productId: dinnerProduct.id },
    });

    const orderData = {
      orderToken,
      idempotencyKey: "idem_ord_e2e_1",
      studentId: testStudent.id,
      productId: dinnerProduct.id,
      amountPaise: dinnerProduct.pricePaise,
      validDate: todayDate,
      razorpayOrderId: razorpayOrder.id,
      status: OrderStatus.CREATED,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min TTL
    };
    const { _store } = (await import("../../lib/prisma.js")) as any;
    const createdOrder = await prisma.couponOrder.create({ data: orderData });
    expect(createdOrder.status).toBe(OrderStatus.CREATED);

    // 2. Student pays via gateway -> Gateway triggers Razorpay Webhook
    const webhookPayload = {
      event: "order.paid",
      payload: {
        order: {
          entity: {
            id: razorpayOrder.id,
            amount_paid: dinnerProduct.pricePaise,
          },
        },
        payment: {
          entity: {
            id: "pay_rzp_test_success_999",
            order_id: razorpayOrder.id,
            amount: dinnerProduct.pricePaise,
            currency: "INR",
          },
        },
      },
    };

    const webhookRes = await paymentService.processWebhook(
      JSON.stringify(webhookPayload),
      "valid_webhook_sig",
      "evt_rzp_e2e_001",
      webhookPayload,
    );
    expect(webhookRes.received).toBe(true);

    // Assert order fulfilled & Coupon created in DB
    const updatedOrder = _store.orders.get(createdOrder.id);
    expect(updatedOrder.status).toBe(OrderStatus.PAID);
    expect(updatedOrder.razorpayPaymentId).toBe("pay_rzp_test_success_999");

    const createdCoupons = Array.from(_store.coupons.values());
    expect(createdCoupons).toHaveLength(1);
    const activeCoupon = createdCoupons[0] as any;
    expect(activeCoupon.status).toBe(CouponStatus.ACTIVE);
    expect(activeCoupon.mealType).toBe(MealType.DINNER);
    expect(activeCoupon.shortCode).toBeDefined();

    // 3. Student requests QR pass on WhatsApp
    const qrResult = await couponWorkflow.generateCouponQr(testStudent.id, activeCoupon.shortCode);
    expect(qrResult.imageBuffer).toBeInstanceOf(Buffer);
    expect(qrResult.imageBuffer.length).toBeGreaterThan(100);
    expect(qrResult.caption).toContain(activeCoupon.shortCode);

    // 4. Student presents coupon at Akshaya mess counter -> Staff scans QR / enters short code
    const staffId = "staff-scanner-01";
    const lookupResult = await redemptionService.lookupCoupon({
      shortCode: activeCoupon.shortCode,
      messId: "mess-akshaya",
      actorId: staffId,
      skipMealWindowCheck: true,
    });
    expect(lookupResult.success).toBe(true);
    expect(lookupResult.canRedeem).toBe(true);
    expect(lookupResult.coupon?.student.rollNo).toBe("2024CS001");

    // Counter staff confirms redemption atomically
    const redeemedCoupon = await redemptionService.redeemCoupon({
      shortCode: activeCoupon.shortCode,
      messId: "mess-akshaya",
      staffId,
      skipMealWindowCheck: true,
    });

    expect(redeemedCoupon.status).toBe(CouponStatus.REDEEMED);
    expect(redeemedCoupon.redeemedById).toBe(staffId);
    expect(_store.redemptions.size).toBe(1);

    // 5. Duplicate Redemption Security: Attempting to redeem the same coupon a second time MUST FAIL
    await expect(
      redemptionService.redeemCoupon({
        shortCode: activeCoupon.shortCode,
        messId: "mess-akshaya",
        staffId,
        skipMealWindowCheck: true,
      }),
    ).rejects.toMatchObject({
      code: "ALREADY_REDEEMED",
    });
  });
});
