import { describe, it, expect, vi, beforeEach } from "vitest";
import { MenuService } from "./menu.service.js";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      mess: {
        findUnique: vi.fn(),
      },
      menu: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      menuItem: {
        deleteMany: vi.fn(),
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

describe("MenuService", () => {
  let service: MenuService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MenuService();
  });

  describe("getMenuRange", () => {
    it("throws BadRequestError if startDate is after endDate", async () => {
      await expect(service.getMenuRange("mess-1", "2026-10-30", "2026-10-25")).rejects.toThrow(
        BadRequestError,
      );
    });

    it("returns formatted menu items in date range", async () => {
      vi.mocked(prisma.menu.findMany).mockResolvedValue([
        {
          id: "menu-1",
          messId: "mess-1",
          date: new Date("2026-10-27T00:00:00.000Z"),
          mealType: "BREAKFAST",
          notes: "Special Idli Sambar",
          createdById: "admin-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: "item-1",
              menuId: "menu-1",
              name: "Idli",
              isVeg: true,
              sortOrder: 0,
              createdAt: new Date(),
            },
            {
              id: "item-2",
              menuId: "menu-1",
              name: "Vada",
              isVeg: true,
              sortOrder: 1,
              createdAt: new Date(),
            },
          ],
        },
      ] as unknown as Array<
        import("@prisma/client").Menu & { items: import("@prisma/client").MenuItem[] }
      >);

      const result = await service.getMenuRange("mess-1", "2026-10-27", "2026-10-27");
      expect(result).toHaveLength(1);
      expect(result[0]!.date).toBe("2026-10-27");
      expect(result[0]!.mealType).toBe("BREAKFAST");
      expect(result[0]!.items).toHaveLength(2);
      expect(result[0]!.items[0]!.name).toBe("Idli");
    });
  });

  describe("upsertMealSlot", () => {
    it("throws NotFoundError if mess does not exist", async () => {
      vi.mocked(prisma.mess.findUnique).mockResolvedValue(null);

      await expect(
        service.upsertMealSlot(
          {
            messId: "unknown-mess",
            date: "2026-10-27",
            mealType: "LUNCH",
            items: [{ name: "Rice", isVeg: true, sortOrder: 0 }],
          },
          "admin-1",
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it("creates a new menu slot when none exists", async () => {
      vi.mocked(prisma.mess.findUnique).mockResolvedValue({
        id: "mess-1",
        code: "AKSHAYA",
        name: "Akshaya",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.menu.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.menu.create).mockResolvedValue({
        id: "new-menu-1",
        messId: "mess-1",
        date: new Date("2026-10-27T00:00:00.000Z"),
        mealType: "LUNCH",
        notes: null,
        createdById: "admin-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: "item-1",
            menuId: "new-menu-1",
            name: "Rice & Dal",
            isVeg: true,
            sortOrder: 0,
            createdAt: new Date(),
          },
        ],
      } as unknown as import("@prisma/client").Menu & {
        items: import("@prisma/client").MenuItem[];
      });

      const result = await service.upsertMealSlot(
        {
          messId: "mess-1",
          date: "2026-10-27",
          mealType: "LUNCH",
          items: [{ name: "Rice & Dal", isVeg: true, sortOrder: 0 }],
        },
        "admin-1",
      );

      expect(result.id).toBe("new-menu-1");
      expect(result.items).toHaveLength(1);
      expect(prisma.menu.create).toHaveBeenCalled();
    });
  });

  describe("copyWeekMenu", () => {
    it("throws BadRequestError if no slots exist in source week", async () => {
      vi.mocked(prisma.menu.findMany).mockResolvedValue([]);

      await expect(
        service.copyWeekMenu(
          {
            messId: "mess-1",
            sourceStartDate: "2026-10-19",
            targetStartDate: "2026-10-26",
          },
          "admin-1",
        ),
      ).rejects.toThrow(BadRequestError);
    });
  });
});
