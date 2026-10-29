import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { RedemptionService } from "../../modules/redemptions/redemption.service.js";
import { MenuFormatter, MealMenuDTO } from "../../modules/whatsapp/workflows/menu.formatter.js";
import { MealType, CouponStatus } from "@prisma/client";
import { getTodayIST, getTodayISTString } from "../../lib/dates-ist.js";
import { generateShortCode, generateToken, hashToken } from "../../lib/tokens.js";

vi.mock("../../lib/prisma.js", () => {
  const store = {
    coupons: new Map<string, any>(),
    shortCodes: new Set<string>(),
    redemptions: new Map<string, any>(),
    students: new Map<string, any>(),
  };

  let lock = Promise.resolve();
  const atomic = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = lock;
    let next!: () => void;
    lock = new Promise<void>((r) => (next = r));
    await prev;
    try {
      return await fn();
    } finally {
      next();
    }
  };

  return {
    _store: store,
    prisma: {
      coupon: {
        findFirst: vi.fn(async ({ where }) => {
          return atomic(async () => {
            for (const c of store.coupons.values()) {
              if (where.shortCode && c.shortCode === where.shortCode) {
                return {
                  ...c,
                  student: store.students.get(c.studentId),
                  mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
                  product: { code: "LUNCH", mealType: c.mealType },
                };
              }
            }
            return null;
          });
        }),
        findUniqueOrThrow: vi.fn(async ({ where }) => {
          const c = store.coupons.get(where.id);
          return {
            ...c,
            student: store.students.get(c.studentId),
            mess: { id: "mess-1", code: "AKSHAYA", name: "Akshaya Mess" },
            product: { code: "LUNCH", mealType: c.mealType },
          };
        }),
        create: vi.fn(async ({ data }) => {
          return atomic(async () => {
            if (store.shortCodes.has(data.shortCode)) {
              throw new Error(`Duplicate shortCode ${data.shortCode}`);
            }
            const c = { id: `cp_${data.shortCode}`, ...data, createdAt: new Date() };
            store.coupons.set(c.id, c);
            store.shortCodes.add(data.shortCode);
            return c;
          });
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          return atomic(async () => {
            const c = store.coupons.get(where.id);
            if (!c || c.status !== where.status) return { count: 0 };
            Object.assign(c, data);
            return { count: 1 };
          });
        }),
        count: vi.fn(async () => store.coupons.size),
      },
      couponRedemption: {
        create: vi.fn(async ({ data }) => {
          return atomic(async () => {
            const r = { id: `red_${Date.now()}_${Math.random()}`, ...data };
            store.redemptions.set(r.id, r);
            return r;
          });
        }),
      },
      dailyMenu: {
        findFirst: vi.fn(async () => ({
          id: "menu-today",
          messId: "mess-1",
          date: getTodayIST(),
          mealType: MealType.LUNCH,
          items: [
            { id: "i1", name: "Paneer Butter Masala", isVeg: true },
            { id: "i2", name: "Jeera Rice", isVeg: true },
            { id: "i3", name: "Roti", isVeg: true },
          ],
        })),
        findMany: vi.fn(async () => []),
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

describe("Phase 23 Load Sanity Suite (§23.5)", () => {
  let redemptionService: RedemptionService;
  let menuFormatter: MenuFormatter;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { _store } = (await import("../../lib/prisma.js")) as any;
    _store.coupons.clear();
    _store.shortCodes.clear();
    _store.redemptions.clear();
    _store.students.clear();

    redemptionService = new RedemptionService();
    menuFormatter = new MenuFormatter();
  });

  it("handles 200 concurrent simulated students with zero duplicate coupons, zero state corruption, and 100% redemption consistency", async () => {
    const { _store } = (await import("../../lib/prisma.js")) as any;
    const today = getTodayIST();
    const todayStr = getTodayISTString();
    const studentCount = 200;

    const sampleMeals: MealMenuDTO[] = [
      {
        mealType: "LUNCH",
        items: [
          { name: "Paneer Butter Masala", isVeg: true },
          { name: "Jeera Rice", isVeg: true },
          { name: "Roti", isVeg: true },
        ],
      },
    ];

    // 1. Simulate 200 students querying the menu simultaneously
    const menuQueries = Array.from({ length: studentCount }, () =>
      menuFormatter.formatDailyMenu(todayStr, sampleMeals),
    );
    expect(menuQueries).toHaveLength(studentCount);
    for (const text of menuQueries) {
      expect(text).toContain("Paneer Butter Masala");
    }

    // 2. Concurrently create 200 unique coupons for 200 students
    const couponCreations = Array.from({ length: studentCount }, async (_, i) => {
      const studentId = `student_${i}`;
      _store.students.set(studentId, {
        id: studentId,
        rollNo: `2024CS${String(i).padStart(3, "0")}`,
        name: `Student ${i}`,
        department: "Engineering",
      });

      const token = generateToken();
      const tokenHash = hashToken(token);
      const shortCode = generateShortCode();

      return prisma.coupon.create({
        data: {
          messId: "mess-1",
          studentId,
          productId: "prod-lunch",
          mealType: MealType.LUNCH,
          validDate: today,
          expiresAt: new Date(Date.now() + 3600000),
          status: CouponStatus.ACTIVE,
          source: "PURCHASE",
          tokenHash,
          shortCode,
        },
      });
    });

    const createdCoupons = await Promise.all(couponCreations);

    // Verify 200 unique coupons created
    expect(createdCoupons).toHaveLength(studentCount);
    expect(_store.coupons.size).toBe(studentCount);
    expect(_store.shortCodes.size).toBe(studentCount);

    // 3. Concurrently redeem all 200 coupons via counter scanner
    const redemptionOperations = createdCoupons.map((c, i) =>
      redemptionService.redeemCoupon({
        shortCode: c.shortCode,
        messId: "mess-1",
        staffId: `staff-counter-${i % 4}`, // 4 staff lanes
        skipMealWindowCheck: true,
      }),
    );

    const redemptionResults = await Promise.all(redemptionOperations);

    expect(redemptionResults).toHaveLength(studentCount);
    expect(_store.redemptions.size).toBe(studentCount);

    for (const c of _store.coupons.values()) {
      expect(c.status).toBe(CouponStatus.REDEEMED);
      expect(c.redeemedAt).toBeDefined();
    }
  });
});
