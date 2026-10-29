import { Router } from "express";
import { giftController } from "./gift.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";
import { idempotency } from "../../middleware/idempotency.js";

export const giftRouter = Router();

// All gift endpoints require admin session
giftRouter.use(requireAuth);

// 20.2 Gift API (issue, list, revoke, resend)
giftRouter.post(
  "/",
  requirePermission("gift:issue"),
  idempotency({ required: false }),
  (req, res, next) => {
    giftController.issueBatch(req, res).catch(next);
  },
);

giftRouter.get("/", requirePermission("gift:view"), (req, res, next) => {
  giftController.listBatches(req, res).catch(next);
});

giftRouter.get("/:id", requirePermission("gift:view"), (req, res, next) => {
  giftController.getBatchDetails(req, res).catch(next);
});

giftRouter.post("/coupons/:couponId/revoke", requirePermission("gift:revoke"), (req, res, next) => {
  giftController.revokeCoupon(req, res).catch(next);
});

giftRouter.post("/:id/resend", requirePermission("gift:resend"), (req, res, next) => {
  giftController.resendNotifications(req, res).catch(next);
});
