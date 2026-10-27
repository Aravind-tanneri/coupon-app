import { prisma } from "../../lib/prisma.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { auditService } from "../audit/audit.service.js";
import { UpsertMealSlotInput, CopyWeekMenuInput } from "./menu.schemas.js";

export class MenuService {
  /**
   * Fetches all menu slots for a mess between startDate and endDate (inclusive).
   */
  async getMenuRange(messId: string, startDateStr: string, endDateStr: string) {
    const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
    const endDate = new Date(`${endDateStr}T23:59:59.999Z`);

    if (startDate > endDate) {
      throw new BadRequestError("startDate must be before or equal to endDate");
    }

    const menus = await prisma.menu.findMany({
      where: {
        messId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ date: "asc" }, { mealType: "asc" }],
    });

    return menus.map((m) => ({
      id: m.id,
      messId: m.messId,
      date: m.date.toISOString().split("T")[0]!,
      mealType: m.mealType,
      notes: m.notes,
      items: m.items.map((item) => ({
        id: item.id,
        name: item.name,
        isVeg: item.isVeg,
        sortOrder: item.sortOrder,
      })),
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
  }

  /**
   * Creates or updates a single meal slot with items in a transaction.
   */
  async upsertMealSlot(input: UpsertMealSlotInput, actorId: string, ip?: string) {
    const slotDate = new Date(`${input.date}T00:00:00.000Z`);

    // Verify mess exists
    const mess = await prisma.mess.findUnique({
      where: { id: input.messId },
    });
    if (!mess) {
      throw new NotFoundError(`Mess with ID ${input.messId} not found`);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Find existing menu slot
      const existing = await tx.menu.findUnique({
        where: {
          messId_date_mealType: {
            messId: input.messId,
            date: slotDate,
            mealType: input.mealType,
          },
        },
        include: { items: true },
      });

      let menuRecord;

      if (existing) {
        // Delete existing items to replace with new set
        await tx.menuItem.deleteMany({
          where: { menuId: existing.id },
        });

        menuRecord = await tx.menu.update({
          where: { id: existing.id },
          data: {
            notes: input.notes,
            items: {
              create: input.items.map((item, idx) => ({
                name: item.name,
                isVeg: item.isVeg,
                sortOrder: item.sortOrder ?? idx,
              })),
            },
          },
          include: {
            items: { orderBy: { sortOrder: "asc" } },
          },
        });
      } else {
        menuRecord = await tx.menu.create({
          data: {
            messId: input.messId,
            date: slotDate,
            mealType: input.mealType,
            notes: input.notes,
            createdById: actorId,
            items: {
              create: input.items.map((item, idx) => ({
                name: item.name,
                isVeg: item.isVeg,
                sortOrder: item.sortOrder ?? idx,
              })),
            },
          },
          include: {
            items: { orderBy: { sortOrder: "asc" } },
          },
        });
      }

      return menuRecord;
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "MENU_SLOT_UPSERTED",
      entityType: "Menu",
      entityId: result.id,
      after: {
        messId: input.messId,
        date: input.date,
        mealType: input.mealType,
        itemCount: input.items.length,
      },
      ip,
    });

    return {
      id: result.id,
      messId: result.messId,
      date: result.date.toISOString().split("T")[0]!,
      mealType: result.mealType,
      notes: result.notes,
      items: result.items,
    };
  }

  /**
   * Copies 7 consecutive days of menus from source week to target week.
   */
  async copyWeekMenu(input: CopyWeekMenuInput, actorId: string, ip?: string) {
    const sourceStart = new Date(`${input.sourceStartDate}T00:00:00.000Z`);
    const sourceEnd = new Date(sourceStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    const targetStart = new Date(`${input.targetStartDate}T00:00:00.000Z`);

    // Fetch all source slots
    const sourceSlots = await prisma.menu.findMany({
      where: {
        messId: input.messId,
        date: {
          gte: sourceStart,
          lte: sourceEnd,
        },
      },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (sourceSlots.length === 0) {
      throw new BadRequestError("No menu slots found in the source week to copy");
    }

    let copiedSlotsCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const slot of sourceSlots) {
        // Compute offset in days from sourceStart
        const dayDiff = Math.round(
          (slot.date.getTime() - sourceStart.getTime()) / (24 * 60 * 60 * 1000),
        );
        const targetSlotDate = new Date(targetStart.getTime() + dayDiff * 24 * 60 * 60 * 1000);

        // Check if target slot exists
        const existing = await tx.menu.findUnique({
          where: {
            messId_date_mealType: {
              messId: input.messId,
              date: targetSlotDate,
              mealType: slot.mealType,
            },
          },
        });

        if (existing) {
          await tx.menuItem.deleteMany({ where: { menuId: existing.id } });
          await tx.menu.update({
            where: { id: existing.id },
            data: {
              notes: slot.notes,
              items: {
                create: slot.items.map((i) => ({
                  name: i.name,
                  isVeg: i.isVeg,
                  sortOrder: i.sortOrder,
                })),
              },
            },
          });
        } else {
          await tx.menu.create({
            data: {
              messId: input.messId,
              date: targetSlotDate,
              mealType: slot.mealType,
              notes: slot.notes,
              createdById: actorId,
              items: {
                create: slot.items.map((i) => ({
                  name: i.name,
                  isVeg: i.isVeg,
                  sortOrder: i.sortOrder,
                })),
              },
            },
          });
        }
        copiedSlotsCount++;
      }
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "MENU_WEEK_COPIED",
      entityType: "Menu",
      entityId: `week-copy-${input.targetStartDate}`,
      after: {
        messId: input.messId,
        sourceStartDate: input.sourceStartDate,
        targetStartDate: input.targetStartDate,
        copiedSlotsCount,
      },
      ip,
    });

    return {
      success: true,
      copiedSlotsCount,
    };
  }

  /**
   * Fetches all meal slots for today in IST.
   */
  async getTodayMenu(messId: string, istDateStr?: string) {
    const today = istDateStr || new Date().toISOString().split("T")[0]!;
    return this.getMenuRange(messId, today, today);
  }
}

export const menuService = new MenuService();
