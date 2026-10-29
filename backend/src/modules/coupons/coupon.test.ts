import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { CouponService } from "./coupon.service.js";
import { PaymentService } from "./payment.service.js";
import { prisma } from "../../lib/prisma.js";
import { BusinessRuleError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      couponProduct: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      couponOrder: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
      },
      coupon: {
        findUnique: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
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

describe("PaymentService (Razorpay HMAC Verification)", () => {
  const service = new PaymentService();
  const secret = "test_razorpay_secret_12345";

  it("verifies valid Razorpay checkout signature", () => {
    const orderId = "order_EK12345678";
    const paymentId = "pay_987654321";
    const validSignature = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    expect(service.verifyRazorpaySignature(orderId, paymentId, validSignature, secret)).toBe(true);
  });

  it("rejects tampered Razorpay checkout signature", () => {
    const orderId = "order_EK12345678";
    const paymentId = "pay_987654321";
    const tamperedSignature = "tampered_signature_hex_value_123456789";

    expect(service.verifyRazorpaySignature(orderId, paymentId, tamperedSignature, secret)).toBe(
      false,
    );
  });

  it("verifies valid Razorpay webhook signature", () => {
    const webhookSecret = "webhook_secret_99999";
    const rawBody = JSON.stringify({ event: "order.paid", id: "evt_123" });
    const validHmac = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    expect(service.verifyWebhookSignature(rawBody, validHmac, webhookSecret)).toBe(true);
  });

  it("rejects tampered webhook signature", () => {
    const webhookSecret = "webhook_secret_99999";
    const rawBody = JSON.stringify({ event: "order.paid", id: "evt_123" });

    expect(service.verifyWebhookSignature(rawBody, "invalid_webhook_hmac", webhookSecret)).toBe(
      false,
    );
  });
});

describe("CouponService", () => {
  let service: CouponService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CouponService();
  });

  describe("createOrder daily cap enforcement", () => {
    it("throws BusinessRuleError when daily cap is reached", async () => {
      vi.mocked(prisma.couponOrder.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.couponProduct.findUnique).mockResolvedValue({
        id: "prod-1",
        messId: "mess-1",
        code: "SPECIAL_LUNCH",
        mealType: "LUNCH",
        pricePaise: 8000,
        active: true,
        dailyCap: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 45 active coupons + 5 pending orders = 50 (cap reached)
      vi.mocked(prisma.coupon.count).mockResolvedValue(45);
      vi.mocked(prisma.couponOrder.count).mockResolvedValue(5);

      await expect(
        service.createOrder({
          studentId: "student-1",
          productId: "prod-1",
          validDate: "2026-10-28",
          idempotencyKey: "idem_key_123456",
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it("creates order successfully when below daily cap", async () => {
      vi.mocked(prisma.couponOrder.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.couponProduct.findUnique).mockResolvedValue({
        id: "prod-1",
        messId: "mess-1",
        code: "SPECIAL_LUNCH",
        mealType: "LUNCH",
        pricePaise: 8000,
        active: true,
        dailyCap: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.coupon.count).mockResolvedValue(10);
      vi.mocked(prisma.couponOrder.count).mockResolvedValue(2);

      vi.mocked(prisma.couponOrder.create).mockResolvedValue({
        id: "order-1",
        studentId: "student-1",
        productId: "prod-1",
        validDate: new Date("2026-10-28T00:00:00.000Z"),
        amountPaise: 8000,
        status: "CREATED",
        razorpayOrderId: "order_mock_12345",
        razorpayPaymentId: null,
        orderToken: "token-1",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey: "idem_key_123456",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as import("@prisma/client").CouponOrder);

      const order = await service.createOrder({
        studentId: "student-1",
        productId: "prod-1",
        validDate: "2026-10-28",
        idempotencyKey: "idem_key_123456",
      });

      expect(order.id).toBe("order-1");
      expect(order.amountPaise).toBe(8000);
      expect(prisma.couponOrder.create).toHaveBeenCalled();
    });
  });

  describe("fulfillOrder", () => {
    it("issues active coupon with shortCode and tokenHash", async () => {
      vi.mocked(prisma.couponOrder.findUnique).mockResolvedValue({
        id: "order-1",
        studentId: "student-1",
        productId: "prod-1",
        validDate: new Date("2026-10-28T00:00:00.000Z"),
        amountPaise: 8000,
        status: "CREATED",
        razorpayOrderId: "order_mock_12345",
        razorpayPaymentId: null,
        orderToken: "token-1",
        expiresAt: new Date(),
        idempotencyKey: "idem_key_123456",
        createdAt: new Date(),
        updatedAt: new Date(),
        product: {
          id: "prod-1",
          messId: "mess-1",
          mealType: "LUNCH",
        },
        coupon: null,
      } as unknown as import("@prisma/client").CouponOrder & {
        product: { id: string; messId: string; mealType: import("@prisma/client").MealType };
        coupon: null;
      });

      vi.mocked(prisma.coupon.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.coupon.create).mockResolvedValue({
        id: "coupon-1",
        messId: "mess-1",
        studentId: "student-1",
        productId: "prod-1",
        mealType: "LUNCH",
        validDate: new Date("2026-10-28T00:00:00.000Z"),
        source: "PURCHASE",
        status: "ACTIVE",
        tokenHash: "hashed-token-val",
        shortCode: "7K9X2MW4",
        orderId: "order-1",
        giftItemId: null,
        expiresAt: new Date(),
        redeemedAt: null,
        redeemedById: null,
        revokedAt: null,
        revokedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as import("@prisma/client").Coupon);

      const result = await service.fulfillOrder("order-1", "pay_mock_999");
      expect(result.coupon.id).toBe("coupon-1");
      expect(result.coupon.status).toBe("ACTIVE");
      expect(result.rawToken).toBeDefined();
      expect(result.rawToken!.length).toBeGreaterThan(10);
      expect(prisma.couponOrder.update).toHaveBeenCalled();
    });
  });
});
