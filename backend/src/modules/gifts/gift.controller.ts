import { Request, Response } from "express";
import { giftService } from "./gift.service.js";
import {
  IssueGiftBatchSchema,
  ListGiftBatchesQuerySchema,
  RevokeGiftCouponSchema,
  ResendGiftNotificationsSchema,
} from "./gift.schemas.js";
import { UnauthorizedError } from "../../lib/errors.js";

export class GiftController {
  async issueBatch(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();

    // Idempotency-Key from header or body
    const headerKey = req.headers["idempotency-key"];
    const idempotencyKey =
      typeof headerKey === "string" && headerKey.trim()
        ? headerKey.trim()
        : req.body.idempotencyKey;

    const input = IssueGiftBatchSchema.parse({
      ...req.body,
      idempotencyKey,
    });

    const result = await giftService.issueBatch(input, req.adminUser.id, req.ip);

    res.status(201).json({
      success: true,
      data: result,
    });
  }

  async listBatches(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();

    const queryMessId = typeof req.query.messId === "string" ? req.query.messId : undefined;

    const query = ListGiftBatchesQuerySchema.parse({
      ...req.query,
      messId: req.adminUser.messId || queryMessId,
    });

    const result = await giftService.listBatches(query);
    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async getBatchDetails(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();

    const id = String(req.params.id);
    const result = await giftService.getBatchDetails(id);
    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async revokeCoupon(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();

    const couponId = String(req.params.couponId);
    const input = RevokeGiftCouponSchema.parse(req.body);

    const result = await giftService.revokeGiftCoupon(
      couponId,
      req.adminUser.id,
      input.reason,
      req.ip,
    );

    res.status(200).json({
      success: true,
      message: "Coupon revoked successfully",
      data: result,
    });
  }

  async resendNotifications(req: Request, res: Response) {
    if (!req.adminUser) throw new UnauthorizedError();

    const id = String(req.params.id);
    const input = ResendGiftNotificationsSchema.parse(req.body);

    const result = await giftService.resendNotifications(id, input, req.adminUser.id, req.ip);

    res.status(200).json({
      success: true,
      message: `Resent ${result.enqueuedCount} notifications`,
      data: result,
    });
  }
}

export const giftController = new GiftController();
