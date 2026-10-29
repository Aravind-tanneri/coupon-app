import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentService } from "./payment.service.js";
import { FakePaymentProvider } from "./fake-payment.provider.js";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    couponOrder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    coupon: {
      create: vi.fn(),
    },
    webhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    whatsAppIdentity: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      return cb(prisma);
    }),
  },
}));

vi.mock("../audit/audit.service.js", () => ({
  auditService: {
    log: vi.fn(),
  },
}));

describe("Phase 18: Coupon Payment Integration (Razorpay)", () => {
  let fakeProvider: FakePaymentProvider;
  let service: PaymentService;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeProvider = new FakePaymentProvider();
    service = new PaymentService(fakeProvider);
  });

  describe("Webhook Signature Validation (§18.4)", () => {
    it("rejects webhook when signature fails validation", async () => {
      await expect(
        service.processWebhook("raw_body_data", "invalid_sig", "evt_123", { event: "order.paid" }),
      ).rejects.toThrow(UnauthorizedError);

      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it("accepts valid webhook signature", async () => {
      vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.webhookEvent.create).mockResolvedValue({
        id: "evt_1",
        provider: "razorpay",
        eventId: "evt_123",
        receivedAt: new Date(),
        processedAt: null,
      });

      const res = await service.processWebhook("raw_body_data", "valid_webhook_sig", "evt_123", {
        event: "order.paid",
        payload: {},
      });

      expect(res.received).toBe(true);
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: { provider: "razorpay", eventId: "evt_123" },
      });
    });
  });

  describe("Replay Protection & Webhook Deduplication (§13, §18.4)", () => {
    it("skips duplicate webhook events without re-processing", async () => {
      // Simulate existing webhook event
      vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue({
        id: "evt_1",
        provider: "razorpay",
        eventId: "evt_duplicate_99",
        receivedAt: new Date(),
        processedAt: new Date(),
      });

      const res = await service.processWebhook(
        "raw_body_data",
        "valid_webhook_sig",
        "evt_duplicate_99",
        { event: "order.paid" },
      );

      expect(res.duplicate).toBe(true);
      expect(prisma.couponOrder.findFirst).not.toHaveBeenCalled();
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });
  });

  describe("Amount Mismatch & Security Guard (§13)", () => {
    it("flags order as NEEDS_REVIEW and creates NO coupon when payment amount does not match", async () => {
      vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.couponOrder.findFirst).mockResolvedValue({
        id: "ord-1",
        amountPaise: 6500, // Expected ₹65
        status: "CREATED",
        productId: "prod-1",
        studentId: "stud-1",
        validDate: new Date("2026-10-30"),
        razorpayOrderId: "order_rzp_123",
        product: { messId: "mess-1", mealType: "DINNER" },
        coupon: null,
      } as never);

      await service.processWebhook("raw_body_data", "valid_webhook_sig", "evt_mismatch_1", {
        event: "order.paid",
        payload: {
          order: {
            entity: {
              id: "order_rzp_123",
              amount_paid: 4500, // Tampered: only paid ₹45!
            },
          },
          payment: {
            entity: {
              id: "pay_tampered_1",
              order_id: "order_rzp_123",
              amount: 4500,
              currency: "INR",
            },
          },
        },
      });

      // Verify order is marked NEEDS_REVIEW
      expect(prisma.couponOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "NEEDS_REVIEW",
          }),
        }),
      );

      // Verify NO coupon was created
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });
  });

  describe("Successful Fulfillment & WhatsApp Notification (§18.4, §18.6)", () => {
    it("fulfills active coupon and marks order PAID when webhook verifies payment", async () => {
      vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.couponOrder.findFirst).mockResolvedValue({
        id: "ord-1",
        amountPaise: 6500,
        status: "CREATED",
        productId: "prod-1",
        studentId: "stud-1",
        validDate: new Date("2026-10-30T00:00:00.000Z"),
        razorpayOrderId: "order_rzp_valid",
        product: { messId: "mess-1", mealType: "DINNER" },
        coupon: null,
      } as never);

      vi.mocked(prisma.coupon.create).mockResolvedValue({
        id: "coup-1",
        shortCode: "DINNER99",
        mealType: "DINNER",
        status: "ACTIVE",
      } as never);

      await service.processWebhook("raw_body_data", "valid_webhook_sig", "evt_success_1", {
        event: "order.paid",
        payload: {
          order: {
            entity: {
              id: "order_rzp_valid",
              amount_paid: 6500,
            },
          },
          payment: {
            entity: {
              id: "pay_success_123",
              order_id: "order_rzp_valid",
              amount: 6500,
              currency: "INR",
            },
          },
        },
      });

      // Assert order marked PAID
      expect(prisma.couponOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PAID",
            razorpayPaymentId: "pay_success_123",
          }),
        }),
      );

      // Assert Coupon created
      expect(prisma.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId: "stud-1",
            source: "PURCHASE",
            status: "ACTIVE",
            mealType: "DINNER",
            orderId: "ord-1",
          }),
        }),
      );
    });
  });

  describe("Public Checkout Details (§18.3)", () => {
    it("returns clean sanitized checkout DTO without exposing sensitive IDs", async () => {
      vi.mocked(prisma.couponOrder.findUnique).mockResolvedValue({
        id: "ord-internal-id",
        orderToken: "order_tok_abc",
        amountPaise: 5000,
        status: "CREATED",
        validDate: new Date("2026-10-30T00:00:00.000Z"),
        razorpayOrderId: "rzp_ord_1",
        expiresAt: new Date(Date.now() + 1800000),
        product: {
          code: "EXTRA_LUNCH",
          mealType: "LUNCH",
          mess: { id: "m-1", code: "AKSHAYA", name: "Akshaya Dining Hall" },
        },
        student: { id: "s-1", name: "Priya Patel", rollNo: "2024CS099" },
        coupon: null,
      } as never);

      const details = await service.getOrderDetails("order_tok_abc");

      expect(details.orderToken).toBe("order_tok_abc");
      expect(details.amountRupees).toBe("50.00");
      expect(details.mealType).toBe("LUNCH");
      expect(details.messName).toBe("Akshaya Dining Hall");
      expect(details.studentName).toBe("Priya Patel");
      // Check that internal DB id is not leaked
      expect(details).not.toHaveProperty("id");
    });
  });

  describe("verifyClientPayment (§18.3)", () => {
    it("verifies payment signature against provider", async () => {
      vi.mocked(prisma.couponOrder.findUnique).mockResolvedValue({
        id: "ord-1",
        orderToken: "order_tok_abc",
        status: "CREATED",
      } as never);

      const res = await service.verifyClientPayment("order_tok_abc", {
        razorpayOrderId: "order_rzp_1",
        razorpayPaymentId: "pay_1",
        razorpaySignature: "valid_payment_sig",
      });

      expect(res.verified).toBe(true);
      expect(res.status).toBe("CREATED");
    });
  });

  describe("Reconciliation & Admin Queues (§18.5, §18.7)", () => {
    it("reconciles pending orders with late payment detection", async () => {
      vi.mocked(prisma.couponOrder.findMany).mockResolvedValue([
        {
          id: "ord-late",
          razorpayOrderId: "rzp_ord_late",
          validDate: new Date("2026-10-01"), // Past date
          amountPaise: 5000,
          status: "CREATED",
        },
      ] as never);

      fakeProvider.fetchOrderStatus = vi.fn().mockResolvedValue({
        status: "paid",
        amountPaise: 5000,
        paymentId: "pay_late_123",
      });

      const res = await service.reconcilePendingOrders();
      expect(res.errors).toBe(0);
      expect(prisma.couponOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "NEEDS_REVIEW" },
        }),
      );
    });

    it("lists orders and filters by NEEDS_REVIEW status", async () => {
      vi.mocked(prisma.couponOrder.count).mockResolvedValue(1);
      vi.mocked(prisma.couponOrder.findMany).mockResolvedValue([
        {
          id: "ord-rev",
          status: "NEEDS_REVIEW",
          amountPaise: 6500,
          product: { code: "DINNER" },
          student: { rollNo: "2024CS01", name: "Bob" },
        },
      ] as never);

      const list = await service.listNeedsReview("mess-1");
      expect(list.total).toBe(1);
      expect(list.items[0]?.status).toBe("NEEDS_REVIEW");
    });
  });
});
