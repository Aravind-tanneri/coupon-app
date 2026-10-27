import { Request, Response } from "express";
import { menuService } from "./menu.service.js";
import { MenuQuerySchema, UpsertMealSlotSchema, CopyWeekMenuSchema } from "./menu.schemas.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";

export class MenuController {
  async getMenuRange(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const query = MenuQuerySchema.parse(req.query);

    let targetMessId = query.messId;
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      targetMessId = req.adminUser.messId;
    }

    if (!targetMessId) {
      throw new BadRequestError("messId is required");
    }

    const result = await menuService.getMenuRange(targetMessId, query.startDate, query.endDate);

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

    if (!targetMessId) {
      throw new BadRequestError("messId is required");
    }

    const result = await menuService.getTodayMenu(targetMessId);

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
