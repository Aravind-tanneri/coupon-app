import { Request, Response } from "express";
import { redemptionService } from "./redemption.service.js";
import {
  LookupCouponSchema,
  RedeemCouponSchema,
  RedemptionListQuerySchema,
} from "./redemption.schemas.js";
import { UnauthorizedError } from "../../lib/errors.js";

export class RedemptionController {
  async lookup(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const input = LookupCouponSchema.parse(req.body);
    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await redemptionService.lookupCoupon({
      ...input,
      messId,
      actorId: req.adminUser.id,
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async redeem(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const input = RedeemCouponSchema.parse(req.body);
    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await redemptionService.redeemCoupon({
      ...input,
      messId,
      staffId: req.adminUser.id,
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async list(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const query = RedemptionListQuerySchema.parse(req.query);

    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      query.messId = req.adminUser.messId;
    }

    const result = await redemptionService.listRedemptions(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getSummary(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    let targetMessId = req.query.messId as string | undefined;
    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      targetMessId = req.adminUser.messId;
    }

    const dateStr = req.query.date as string | undefined;

    const summary = await redemptionService.getRedemptionSummary(targetMessId, dateStr);

    res.status(200).json({
      success: true,
      data: summary,
    });
  }
}

export const redemptionController = new RedemptionController();
