import { describe, it, expect, vi, beforeEach } from "vitest";
import { couponWorkflow } from "./coupon.workflow.js";
import { prisma } from "../../../lib/prisma.js";
import { couponService } from "../../coupons/coupon.service.js";
import { NotFoundError, BusinessRuleError } from "../../../lib/errors.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    coupon: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    couponProduct: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../coupons/coupon.service.js", () => ({
  couponService: {
    createOrder: vi.fn(),
  },
}));

describe("CouponWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listMyCoupons (§15.2)", () => {
    it("returns empty state message when student has no coupons", async () => {
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([]);

      const result = await couponWorkflow.listMyCoupons("student-1");

      expect(result.text).toContain("no active or recent coupons");
      expect(result.buttons).toEqual([{ id: "BUY_COUPON", title: "Buy Extra Coupon" }]);
    });

    it("formats purchased passes and feast gifts with short refs and QR buttons", async () => {
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        {
          id: "c1",
          studentId: "student-1",
          messId: "mess-1",
          productId: "prod-1",
          shortCode: "ABC123",
          tokenHash: "hash-1",
          mealType: "DINNER",
          validDate: new Date("2026-10-30T00:00:00.000Z"),
          status: "ACTIVE",
          source: "PURCHASE",
          orderId: "ord-1",
          giftItemId: null,
          redeemedAt: null,
          redeemedById: null,
          revokedAt: null,
          revokedById: null,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "c2",
          studentId: "student-1",
          messId: "mess-1",
          productId: null,
          shortCode: "FEAST7",
          tokenHash: "hash-2",
          mealType: "SPECIAL_DINNER",
          validDate: new Date("2026-11-01T00:00:00.000Z"),
          status: "ACTIVE",
          source: "ADMIN_GIFT",
          orderId: null,
          giftItemId: "gift-item-1",
          redeemedAt: null,
          redeemedById: null,
          revokedAt: null,
          revokedById: null,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await couponWorkflow.listMyCoupons("student-1");

      expect(result.text).toContain("Purchased Meal Passes");
      expect(result.text).toContain("*#1*: 🍽️ *Dinner*");
      expect(result.text).toContain("ABC123");
      expect(result.text).toContain("Special Feast Gifts");
      expect(result.text).toContain("FEAST7");
      expect(result.buttons).toEqual([
        { id: "SHOW_QR:ABC123", title: "Pass ABC123" },
        { id: "SHOW_QR:FEAST7", title: "Pass FEAST7" },
      ]);
    });
  });

  describe("generateCouponQr (§15.3)", () => {
    it("throws NotFoundError if coupon is not found", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue(null);

      await expect(couponWorkflow.generateCouponQr("student-1", "UNKNOWN")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws BusinessRuleError if coupon is already REDEEMED", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "c1",
        studentId: "student-1",
        messId: "mess-1",
        productId: "prod-1",
        shortCode: "REDEEMED1",
        tokenHash: "hash-1",
        mealType: "LUNCH",
        validDate: new Date("2026-10-29T00:00:00.000Z"),
        status: "REDEEMED",
        source: "PURCHASE",
        orderId: "ord-1",
        giftItemId: null,
        redeemedAt: new Date(),
        redeemedById: "staff-1",
        revokedAt: null,
        revokedById: null,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(couponWorkflow.generateCouponQr("student-1", "REDEEMED1")).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it("generates PNG QR buffer with counter code and zero PII in caption", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "c1",
        studentId: "student-1",
        messId: "mess-1",
        productId: "prod-1",
        shortCode: "VALID89",
        tokenHash: "hash-1",
        mealType: "DINNER",
        validDate: new Date("2026-10-30T00:00:00.000Z"),
        status: "ACTIVE",
        source: "PURCHASE",
        orderId: "ord-1",
        giftItemId: null,
        redeemedAt: null,
        redeemedById: null,
        revokedAt: null,
        revokedById: null,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const qr = await couponWorkflow.generateCouponQr("student-1", "VALID89");

      expect(qr.shortCode).toBe("VALID89");
      expect(qr.caption).toContain("VALID89");
      expect(qr.caption).toContain("Dinner");
      // Check for strict security: zero PII in the caption
      expect(qr.caption).not.toContain("student-1");
      expect(qr.caption).not.toContain("2024CS");

      // Verify PNG magic bytes: 0x89 0x50 0x4E 0x47 (\x89PNG)
      expect(Buffer.isBuffer(qr.imageBuffer)).toBe(true);
      expect(qr.imageBuffer[0]).toBe(0x89);
      expect(qr.imageBuffer[1]).toBe(0x50);
      expect(qr.imageBuffer[2]).toBe(0x4e);
      expect(qr.imageBuffer[3]).toBe(0x47);
    });
  });

  describe("initiatePurchase (§15.4)", () => {
    it("throws BusinessRuleError when product is inactive or not found", async () => {
      vi.mocked(prisma.couponProduct.findUnique).mockResolvedValue(null);

      await expect(
        couponWorkflow.initiatePurchase("student-1", "mess-1", "NON_EXISTENT"),
      ).rejects.toThrow(BusinessRuleError);
    });

    it("creates order and returns secure checkout URL with zero coupon creation", async () => {
      const mockProduct = {
        id: "prod-1",
        messId: "mess-1",
        code: "EXTRA_DINNER",
        mealType: "DINNER" as const,
        pricePaise: 6500,
        dailyCap: 50,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.couponProduct.findUnique).mockResolvedValue(mockProduct);

      vi.mocked(couponService.createOrder).mockResolvedValue({
        id: "ord-123",
        studentId: "student-1",
        productId: "prod-1",
        amountPaise: 6500,
        validDate: new Date("2026-10-30T00:00:00.000Z"),
        status: "CREATED",
        orderToken: "token_abc_123",
        razorpayOrderId: null,
        razorpayPaymentId: null,
        idempotencyKey: "wa_key_1",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
        product: mockProduct,
      });

      const result = await couponWorkflow.initiatePurchase(
        "student-1",
        "mess-1",
        "EXTRA_DINNER",
        "2026-10-30",
      );

      expect(result.paymentUrl).toContain("/pay/token_abc_123");
      expect(result.text).toContain("₹65.00");
      expect(result.text).toContain("EXTRA_DINNER");
      expect(couponService.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: "student-1",
          productId: "prod-1",
          validDate: "2026-10-30",
        }),
      );
    });
  });
});
