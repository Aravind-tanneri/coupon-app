import { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { menuService } from "./menu.service.js";
import { MenuQuerySchema, UpsertMealSlotSchema, CopyWeekMenuSchema } from "./menu.schemas.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";

export class MenuController {
  private async resolveMessId(
    requestedMessId?: string,
    userMessId?: string | null,
  ): Promise<string> {
    const candidate = requestedMessId || userMessId;
    if (candidate && candidate !== "default") {
      const mess = await prisma.mess.findFirst({
        where: {
          OR: [{ id: candidate }, { code: candidate }],
        },
      });
      if (mess) return mess.id;
      return candidate;
    }

    const defaultMess = await prisma.mess.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
    });

    if (defaultMess) {
      return defaultMess.id;
    }

    throw new BadRequestError("messId is required");
  }

  async getMenuRange(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const query = MenuQuerySchema.parse(req.query);

    let targetMessId = query.messId;
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      targetMessId = req.adminUser.messId;
    }

    const resolvedMessId = await this.resolveMessId(targetMessId, req.adminUser.messId);

    const result = await menuService.getMenuRange(resolvedMessId, query.startDate, query.endDate);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getTodayMenu(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    let targetMessId = req.query.messId as string | undefined;
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      targetMessId = req.adminUser.messId;
    }

    const resolvedMessId = await this.resolveMessId(targetMessId, req.adminUser.messId);

    const result = await menuService.getTodayMenu(resolvedMessId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async upsertSlot(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const input = UpsertMealSlotSchema.parse(req.body);
    const resolvedMessId = await this.resolveMessId(input.messId, req.adminUser.messId);
    input.messId = resolvedMessId;

    if (
      req.adminUser.role !== "SUPER_ADMIN" &&
      req.adminUser.messId &&
      input.messId !== req.adminUser.messId
    ) {
      throw new UnauthorizedError("You do not have access to edit menus for this mess");
    }

    const result = await menuService.upsertMealSlot(input, req.adminUser.id, req.ip);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async copyWeek(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const input = CopyWeekMenuSchema.parse(req.body);
    const resolvedMessId = await this.resolveMessId(input.messId, req.adminUser.messId);
    input.messId = resolvedMessId;

    if (
      req.adminUser.role !== "SUPER_ADMIN" &&
      req.adminUser.messId &&
      input.messId !== req.adminUser.messId
    ) {
      throw new UnauthorizedError("You do not have access to copy menus for this mess");
    }

    const result = await menuService.copyWeekMenu(input, req.adminUser.id, req.ip);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
}

export const menuController = new MenuController();
