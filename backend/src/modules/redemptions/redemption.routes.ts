import { Router } from "express";
import { redemptionController } from "./redemption.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";

export const redemptionRouter = Router();

redemptionRouter.post(
  "/lookup",
  requireAuth,
  requirePermission("redemption:scan"),
  (req, res, next) => {
    redemptionController.lookup(req, res).catch(next);
  },
);

redemptionRouter.post("/", requireAuth, requirePermission("redemption:scan"), (req, res, next) => {
  redemptionController.redeem(req, res).catch(next);
});

redemptionRouter.get("/", requireAuth, requirePermission("redemption:view"), (req, res, next) => {
  redemptionController.list(req, res).catch(next);
});

redemptionRouter.get(
  "/summary",
  requireAuth,
  requirePermission("redemption:view"),
  (req, res, next) => {
    redemptionController.getSummary(req, res).catch(next);
  },
);
