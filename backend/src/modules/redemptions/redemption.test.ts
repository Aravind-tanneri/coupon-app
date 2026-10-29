import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedemptionService } from "./redemption.service.js";
import { prisma } from "../../lib/prisma.js";
import { ConflictError } from "../../lib/errors.js";
import { getTodayIST } from "../../lib/dates-ist.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      coupon: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
        groupBy: vi.fn(),
      },
      couponRedemption: {
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      setting: {
        findUnique: vi.fn(),
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

describe("RedemptionService", () => {
  let service: RedemptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RedemptionService();
  });

  describe("lookupCoupon", () => {
    it("returns canRedeem: true for valid active coupon for today", async () => {
      const todayDate = getTodayIST();
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-1",
        messId: "mess-1",
        status: "ACTIVE",
        validDate: todayDate,
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
        student: { id: "s1", rollNo: "2024CS01", name: "Alice", department: "CSE" },
        product: { id: "p1", code: "LUNCH", mealType: "LUNCH", pricePaise: 5000 },
        mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
      } as unknown as import("@prisma/client").Coupon & {
        student: { id: string; rollNo: string; name: string; department: string };
        product: {
          id: string;
          code: string;
          mealType: import("@prisma/client").MealType;
          pricePaise: number;
        };
        mess: { id: string; code: string; name: string };
      });

      const res = await service.lookupCoupon({
        shortCode: "7K9X2MW4",
        messId: "mess-1",
        actorId: "staff-1",
        skipMealWindowCheck: true,
      });

      expect(res.success).toBe(true);
      expect(res.canRedeem).toBe(true);
      expect(res.coupon?.student.rollNo).toBe("2024CS01");
    });

    it("returns canRedeem: false with ALREADY_REDEEMED when coupon status is REDEEMED", async () => {
      const todayDate = getTodayIST();
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-1",
        messId: "mess-1",
        status: "REDEEMED",
        validDate: todayDate,
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
        redeemedAt: new Date(),
        student: { id: "s1", rollNo: "2024CS01", name: "Alice", department: "CSE" },
        product: { id: "p1", code: "LUNCH", mealType: "LUNCH", pricePaise: 5000 },
        mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
      } as unknown as import("@prisma/client").Coupon & {
        student: { id: string; rollNo: string; name: string; department: string };
        product: {
          id: string;
          code: string;
          mealType: import("@prisma/client").MealType;
          pricePaise: number;
        };
        mess: { id: string; code: string; name: string };
      });

      const res = await service.lookupCoupon({
        shortCode: "7K9X2MW4",
        messId: "mess-1",
        actorId: "staff-1",
        skipMealWindowCheck: true,
      });

      expect(res.success).toBe(true);
      expect(res.canRedeem).toBe(false);
      expect(res.reason).toBe("ALREADY_REDEEMED");
    });

    it("returns canRedeem: false with WRONG_MESS when coupon is for another mess", async () => {
      const todayDate = getTodayIST();
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-1",
        messId: "mess-other",
        status: "ACTIVE",
        validDate: todayDate,
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
        student: { id: "s1", rollNo: "2024CS01", name: "Alice", department: "CSE" },
        product: { id: "p1", code: "LUNCH", mealType: "LUNCH", pricePaise: 5000 },
        mess: { id: "mess-other", code: "AMRUTHA", name: "Amrutha Mess" },
      } as unknown as import("@prisma/client").Coupon & {
        student: { id: string; rollNo: string; name: string; department: string };
        product: {
          id: string;
          code: string;
          mealType: import("@prisma/client").MealType;
          pricePaise: number;
        };
        mess: { id: string; code: string; name: string };
      });

      const res = await service.lookupCoupon({
        shortCode: "7K9X2MW4",
        messId: "mess-1",
        actorId: "staff-1",
        skipMealWindowCheck: true,
      });

      expect(res.canRedeem).toBe(false);
      expect(res.reason).toBe("WRONG_MESS");
    });

    it("returns reason: NOT_FOUND when coupon is not in the database", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue(null);

      const res = await service.lookupCoupon({
        shortCode: "UNKNOWN9",
        messId: "mess-1",
        actorId: "staff-1",
      });

      expect(res.canRedeem).toBe(false);
      expect(res.reason).toBe("NOT_FOUND");
    });
  });

  describe("redeemCoupon", () => {
    it("successfully redeems an active coupon atomically", async () => {
      const todayDate = getTodayIST();
      const mockCoupon = {
        id: "coupon-1",
        messId: "mess-1",
        status: "ACTIVE",
        validDate: todayDate,
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
        shortCode: "7K9X2MW4",
        student: { id: "s1", rollNo: "2024CS01", name: "Alice", department: "CSE" },
        product: { id: "p1", code: "LUNCH", mealType: "LUNCH" },
        mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
      };

      vi.mocked(prisma.coupon.findFirst).mockResolvedValue(
        mockCoupon as unknown as import("@prisma/client").Coupon,
      );
      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.couponRedemption.create).mockResolvedValue({
        id: "redemption-1",
        couponId: "coupon-1",
        staffId: "staff-1",
        at: new Date(),
      });
      vi.mocked(prisma.coupon.findUniqueOrThrow).mockResolvedValue({
        ...mockCoupon,
        status: "REDEEMED",
        redeemedAt: new Date(),
        redeemedById: "staff-1",
      } as unknown as import("@prisma/client").Coupon & {
        student: { id: string; rollNo: string; name: string; department: string };
        product: { id: string; code: string; mealType: import("@prisma/client").MealType };
        mess: { id: string; code: string; name: string };
      });

      const res = await service.redeemCoupon({
        shortCode: "7K9X2MW4",
        messId: "mess-1",
        staffId: "staff-1",
        skipMealWindowCheck: true,
      });

      expect(res.id).toBe("coupon-1");
      expect(res.status).toBe("REDEEMED");
      expect(prisma.coupon.updateMany).toHaveBeenCalled();
      expect(prisma.couponRedemption.create).toHaveBeenCalled();
    });

    it("throws ConflictError ALREADY_REDEEMED on concurrent race condition where count is 0", async () => {
      const todayDate = getTodayIST();
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-1",
        messId: "mess-1",
        status: "REDEEMED",
        validDate: todayDate,
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
        redeemedAt: new Date(),
        redeemedById: "other-staff",
      } as unknown as import("@prisma/client").Coupon);

      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toThrowError(ConflictError);
    });

    it("throws ConflictError WRONG_MESS if coupon belongs to a different mess", async () => {
      const todayDate = getTodayIST();
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-1",
        messId: "mess-other",
        status: "ACTIVE",
        validDate: todayDate,
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
      } as unknown as import("@prisma/client").Coupon);

      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toThrowError(/different mess/);
    });

    it("throws ConflictError NOT_FOUND if coupon code does not exist", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue(null);

      await expect(
        service.redeemCoupon({
          shortCode: "NONEXIST",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toThrowError(ConflictError);
    });

    it("rejects redemption if current time is outside the meal window", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "c-outside",
        messId: "mess-1",
        status: "ACTIVE",
        validDate: getTodayIST(),
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "BREAKFAST", // e.g. at dinner time
      } as unknown as import("@prisma/client").Coupon);

      // Force setting to meal window that doesn't match now
      vi.mocked(prisma.setting.findUnique).mockResolvedValue({
        key: "meal_windows_mess-1",
        value: {
          BREAKFAST: { start: "00:00", end: "00:01" }, // strictly closed
        },
      } as never);

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: false,
        }),
      ).rejects.toMatchObject({ code: "OUTSIDE_MEAL_WINDOW" });
    });

    it("throws WRONG_DATE if coupon is for a different date when update fails", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "c-diff-date",
        messId: "mess-1",
        status: "ACTIVE",
        validDate: new Date("2026-10-01T00:00:00.000Z"), // Different date
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
      } as unknown as import("@prisma/client").Coupon);
      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toMatchObject({ code: "WRONG_DATE" });
    });
  });

  describe("getRedemptionSummary", () => {
    it("returns today's redemption counts and breakdown by meal", async () => {
      vi.mocked(prisma.coupon.count).mockResolvedValue(42);
      vi.mocked(prisma.coupon.groupBy).mockResolvedValue([
        { mealType: "LUNCH", _count: { id: 30 } },
        { mealType: "DINNER", _count: { id: 12 } },
      ] as unknown as never);
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        {
          id: "c1",
          shortCode: "7K9X2MW4",
          mealType: "LUNCH",
          redeemedAt: new Date(),
          student: { rollNo: "2024CS01", name: "Alice", department: "CSE" },
          product: { code: "LUNCH" },
        },
      ] as unknown as import("@prisma/client").Coupon[]);

      const summary = await service.getRedemptionSummary("mess-1");
      expect(summary.totalRedeemedToday).toBe(42);
      expect(summary.byMeal.LUNCH).toBe(30);
      expect(summary.byMeal.DINNER).toBe(12);
      expect(summary.byMeal.BREAKFAST).toBe(0);
      expect(summary.recentFeed).toHaveLength(1);
    });
  });

  describe("listRedemptions", () => {
    it("returns paginated redemption list with filtering and search", async () => {
      vi.mocked(prisma.coupon.count).mockResolvedValue(1);
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        {
          id: "c-100",
          shortCode: "ABCDEFGH",
          status: "REDEEMED",
          student: { id: "s1", rollNo: "2024CS01", name: "Alice", department: "CSE" },
          product: { id: "p1", code: "LUNCH", mealType: "LUNCH" },
          mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
          redemption: { id: "r1", staffId: "staff-1", at: new Date() },
        },
      ] as unknown as import("@prisma/client").Coupon[]);

      const result = await service.listRedemptions({
        messId: "mess-1",
        mealType: "LUNCH",
        date: "2026-10-29",
        search: "Alice",
        page: 1,
        pageSize: 20,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.student.name).toBe("Alice");
    });
  });

  describe("atomic failure classification on concurrent conflict", () => {
    it("throws WRONG_MESS if coupon belongs to another mess when update fails", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-diff-mess",
        messId: "mess-other",
        status: "ACTIVE",
        validDate: getTodayIST(),
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
      } as unknown as import("@prisma/client").Coupon);
      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toMatchObject({ code: "WRONG_MESS" });
    });

    it("throws REVOKED if coupon is revoked when update fails", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-revoked",
        messId: "mess-1",
        status: "REVOKED",
        validDate: getTodayIST(),
        expiresAt: new Date(Date.now() + 3600000),
        mealType: "LUNCH",
      } as unknown as import("@prisma/client").Coupon);
      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toMatchObject({ code: "REVOKED" });
    });

    it("throws EXPIRED if coupon has passed expiry when update fails", async () => {
      vi.mocked(prisma.coupon.findFirst).mockResolvedValue({
        id: "coupon-expired",
        messId: "mess-1",
        status: "ACTIVE",
        validDate: getTodayIST(),
        expiresAt: new Date(Date.now() - 3600000), // past
        mealType: "LUNCH",
      } as unknown as import("@prisma/client").Coupon);
      vi.mocked(prisma.coupon.updateMany).mockResolvedValue({ count: 0 });

      await expect(
        service.redeemCoupon({
          shortCode: "7K9X2MW4",
          messId: "mess-1",
          staffId: "staff-1",
          skipMealWindowCheck: true,
        }),
      ).rejects.toMatchObject({ code: "EXPIRED" });
    });
  });
});
