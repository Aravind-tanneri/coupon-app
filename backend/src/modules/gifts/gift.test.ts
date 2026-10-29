import { describe, it, expect, vi, beforeEach } from "vitest";
import { giftService } from "./gift.service.js";
import { prisma } from "../../lib/prisma.js";
import { CouponStatus } from "@prisma/client";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { getTodayISTString } from "../../lib/dates-ist.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    mess: {
      findUnique: vi.fn(),
    },
    student: {
      findMany: vi.fn(),
    },
    giftBatch: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    giftItem: {
      create: vi.fn(),
      update: vi.fn(),
    },
    coupon: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../audit/audit.service.js", () => ({
  auditService: {
    log: vi.fn(),
  },
}));

describe("Phase 20: Admin Gift Coupons (§19, §20)", () => {
  const todayStr = getTodayISTString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("20.1 Gift batch issuance service & deduplication", () => {
    it("rejects meal dates in the past (§19)", async () => {
      await expect(
        giftService.issueBatch(
          {
            messId: "mess-1",
            mealDate: "2020-01-01",
            studentIds: ["s1"],
          },
          "admin-1",
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("throws NotFoundError if mess does not exist", async () => {
      vi.mocked(prisma.mess.findUnique).mockResolvedValue(null);

      await expect(
        giftService.issueBatch(
          {
            messId: "nonexistent-mess",
            mealDate: todayStr,
            studentIds: ["s1"],
          },
          "admin-1",
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it("deduplicates student array and skips students who already hold an active gift for that date", async () => {
      vi.mocked(prisma.mess.findUnique).mockResolvedValue({
        id: "mess-1",
        code: "AKSHAYA",
        name: "Akshaya Mess",
        active: true,
      } as never);

      // Input has duplicate 'stud-1' and new 'stud-2'
      vi.mocked(prisma.giftBatch.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.student.findMany).mockResolvedValue([
        { id: "stud-1", rollNo: "R01", name: "Alice", email: "alice@test.edu" },
        { id: "stud-2", rollNo: "R02", name: "Bob", email: "bob@test.edu" },
      ] as never);

      // stud-1 already has a gift coupon for this date
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([{ studentId: "stud-1" }] as never);

      // Setup $transaction mock
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => {
        if (typeof callback === "function") {
          const fakeTx = {
            giftBatch: {
              create: vi.fn().mockResolvedValue({ id: "batch-101" }),
            },
            giftItem: {
              create: vi.fn().mockResolvedValue({ id: "item-101" }),
              update: vi.fn().mockResolvedValue({ id: "item-101" }),
            },
            coupon: {
              create: vi.fn().mockResolvedValue({ id: "coupon-101" }),
            },
            notification: {
              createMany: vi.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return (callback as (tx: typeof fakeTx) => Promise<unknown>)(fakeTx);
        }
        return [] as never;
      });

      const result = await giftService.issueBatch(
        {
          messId: "mess-1",
          mealDate: todayStr,
          studentIds: ["stud-1", "stud-1", "stud-2"], // 3 entries, 1 duplicate in array, 1 already gifted
          message: "Diwali Feast 2026",
          idempotencyKey: "key-123",
        },
        "admin-1",
      );

      expect(result.totalRequested).toBe(3);
      expect(result.issued).toBe(1); // Only stud-2 gets issued
      expect(result.skippedDuplicate).toBe(2); // 1 array duplicate + 1 already holding gift
      expect(result.failed).toBe(0);
      expect(result.batchId).toBe("batch-101");
    });

    it("idempotency: retrying the same request returns existing batch without re-issuing coupons (§19)", async () => {
      vi.mocked(prisma.mess.findUnique).mockResolvedValue({
        id: "mess-1",
        code: "AKSHAYA",
        name: "Akshaya Mess",
        active: true,
      } as never);

      const existingDate = new Date(`${todayStr}T00:00:00.000Z`);

      // Mock finding existing batch by idempotencyKey
      vi.mocked(prisma.giftBatch.findUnique).mockResolvedValue({
        id: "batch-existing",
        messId: "mess-1",
        mealDate: existingDate,
        message: "Festival Gift",
        idempotencyKey: "same-key-abc",
        status: "COMPLETED",
        createdAt: new Date(),
        items: [
          { id: "item-1", studentId: "stud-1", couponId: "coup-1" },
          { id: "item-2", studentId: "stud-2", couponId: "coup-2" },
        ],
      } as never);

      vi.mocked(prisma.giftBatch.findUniqueOrThrow).mockResolvedValue({
        id: "batch-existing",
        messId: "mess-1",
        mealDate: existingDate,
        message: "Festival Gift",
        idempotencyKey: "same-key-abc",
        status: "COMPLETED",
        createdAt: new Date(),
        items: [
          { id: "item-1", studentId: "stud-1", couponId: "coup-1" },
          { id: "item-2", studentId: "stud-2", couponId: "coup-2" },
        ],
      } as never);

      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        { id: "coup-1", shortCode: "CODE1234" },
        { id: "coup-2", shortCode: "CODE5678" },
      ] as never);

      const result = await giftService.issueBatch(
        {
          messId: "mess-1",
          mealDate: todayStr,
          studentIds: ["stud-1", "stud-2"],
          idempotencyKey: "same-key-abc",
        },
        "admin-1",
      );

      // Returned batch is the existing one, no transaction called
      expect(result.batchId).toBe("batch-existing");
      expect(result.issued).toBe(2);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("20.4 Revocation with atomic guard", () => {
    it("successfully revokes an ACTIVE gift coupon", async () => {
      vi.mocked(prisma.coupon.findUnique).mockResolvedValue({
        id: "coup-1",
        source: "ADMIN_GIFT",
        status: CouponStatus.ACTIVE,
        shortCode: "GIFT8888",
        mess: { id: "m1", code: "AKSHAYA", name: "Akshaya" },
        student: { id: "s1", rollNo: "2024CS01", name: "Bob", email: "bob@test.edu" },
      } as never);

      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 1 });

      const res = await giftService.revokeGiftCoupon("coup-1", "admin-1", "Student opted out");

      expect(res.status).toBe(CouponStatus.REVOKED);
      expect(res.id).toBe("coup-1");
      expect(prisma.coupon.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "coup-1",
            status: CouponStatus.ACTIVE,
          },
          data: expect.objectContaining({
            status: CouponStatus.REVOKED,
            revokedById: "admin-1",
          }),
        }),
      );
    });

    it("rejects non-gift coupon revocation through gift endpoint", async () => {
      vi.mocked(prisma.coupon.findUnique).mockResolvedValue({
        id: "coup-purchased",
        source: "PURCHASE",
        status: CouponStatus.ACTIVE,
        mess: { id: "m1", code: "AKSHAYA", name: "Akshaya" },
        student: { id: "s1", rollNo: "2024CS01", name: "Bob", email: "bob@test.edu" },
      } as never);

      await expect(giftService.revokeGiftCoupon("coup-purchased", "admin-1")).rejects.toThrow(
        BadRequestError,
      );
    });

    it("CRITICAL AC (§20.4): refuses revocation if coupon is already REDEEMED", async () => {
      // Step 1: Initial query finds active or redeemed
      vi.mocked(prisma.coupon.findUnique)
        .mockResolvedValueOnce({
          id: "coup-redeemed",
          source: "ADMIN_GIFT",
          status: CouponStatus.ACTIVE, // Appeared active initially
          mess: { id: "m1", code: "AKSHAYA", name: "Akshaya" },
          student: { id: "s1", rollNo: "2024CS01", name: "Bob", email: "bob@test.edu" },
        } as never)
        // Step 2: Atomic update fails (count = 0) because counter redeemed it in a race
        .mockResolvedValueOnce({
          id: "coup-redeemed",
          source: "ADMIN_GIFT",
          status: CouponStatus.REDEEMED,
          redeemedAt: new Date(),
          redeemedById: "staff-1",
        } as never);

      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      let caughtError: ConflictError | null = null;
      try {
        await giftService.revokeGiftCoupon("coup-redeemed", "admin-1");
      } catch (err: unknown) {
        caughtError = err as ConflictError;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError).toBeInstanceOf(ConflictError);
      expect(caughtError?.code).toBe("CANNOT_REVOKE_REDEEMED");
    });
  });

  describe("20.2 Batch listing & details with redemption status", () => {
    it("lists gift batches with calculated active/redeemed/revoked counts", async () => {
      const mealDate = new Date(`${todayStr}T00:00:00.000Z`);

      vi.mocked(prisma.$transaction).mockResolvedValue([
        1, // total count
        [
          {
            id: "batch-1",
            messId: "m1",
            createdById: "admin-1",
            mealDate,
            message: "Welcome Dinner",
            idempotencyKey: "k-1",
            status: "COMPLETED",
            createdAt: new Date(),
            mess: { id: "m1", code: "AKSHAYA", name: "Akshaya" },
            items: [
              { id: "i1", couponId: "c1" },
              { id: "i2", couponId: "c2" },
              { id: "i3", couponId: "c3" },
            ],
          },
        ],
      ] as never);

      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        { id: "c1", status: CouponStatus.ACTIVE },
        { id: "c2", status: CouponStatus.REDEEMED },
        { id: "c3", status: CouponStatus.REVOKED },
      ] as never);

      const result = await giftService.listBatches({ page: 1, pageSize: 20 });

      expect(result.total).toBe(1);
      expect(result.batches[0]?.counts).toEqual({
        total: 3,
        active: 1,
        redeemed: 1,
        revoked: 1,
      });
    });

    it("retrieves batch details with student records and coupon statuses", async () => {
      const mealDate = new Date(`${todayStr}T00:00:00.000Z`);

      vi.mocked(prisma.giftBatch.findUnique).mockResolvedValue({
        id: "batch-1",
        messId: "m1",
        createdById: "admin-1",
        mealDate,
        message: "Welcome Dinner",
        idempotencyKey: "k-1",
        status: "COMPLETED",
        createdAt: new Date(),
        mess: { id: "m1", code: "AKSHAYA", name: "Akshaya" },
        items: [{ id: "item-1", studentId: "stud-1", couponId: "coup-1", createdAt: new Date() }],
      } as never);

      vi.mocked(prisma.student.findMany).mockResolvedValue([
        {
          id: "stud-1",
          rollNo: "2024CS001",
          name: "Alice",
          email: "alice@test.edu",
          department: "CSE",
        },
      ] as never);

      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        {
          id: "coup-1",
          shortCode: "CROCK123",
          status: CouponStatus.ACTIVE,
          validDate: mealDate,
          mealType: "SPECIAL_DINNER",
          redeemedAt: null,
          revokedAt: null,
        },
      ] as never);

      const details = await giftService.getBatchDetails("batch-1");

      expect(details.id).toBe("batch-1");
      expect(details.items[0]?.student?.name).toBe("Alice");
      expect(details.items[0]?.coupon?.shortCode).toBe("CROCK123");
      expect(details.counts.active).toBe(1);
    });
  });

  describe("20.2 Resend notifications (§19)", () => {
    it("enqueues notification outbox rows without creating or altering coupons", async () => {
      const mealDate = new Date(`${todayStr}T00:00:00.000Z`);

      vi.mocked(prisma.giftBatch.findUnique).mockResolvedValue({
        id: "batch-1",
        messId: "m1",
        mealDate,
        message: "Special Feast",
        items: [
          {
            id: "i1",
            studentId: "s1",
            couponId: "c1",
            emailStatus: "FAILED",
            whatsappStatus: "FAILED",
          },
        ],
      } as never);

      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        { id: "c1", shortCode: "ABCD1234", status: CouponStatus.ACTIVE },
      ] as never);

      const res = await giftService.resendNotifications("batch-1", { channel: "ALL" }, "admin-1");

      expect(res.enqueuedCount).toBe(2); // 1 email + 1 whatsapp
      expect(prisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ channel: "EMAIL", template: "GIFT_COUPON_EMAIL" }),
            expect.objectContaining({ channel: "WHATSAPP", template: "GIFT_COUPON_WHATSAPP" }),
          ]),
        }),
      );
      expect(prisma.coupon.create).not.toHaveBeenCalled();
    });
  });
});
