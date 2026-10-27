import { Router } from "express";
import { feedbackController } from "./feedback.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";

export const feedbackRouter = Router();

// Public / student submission route
feedbackRouter.post("/", (req, res, next) => {
  feedbackController.submit(req, res).catch(next);
});

// Admin management routes
feedbackRouter.use(requireAuth);

feedbackRouter.get("/", requirePermission("feedback:view"), (req, res, next) => {
  feedbackController.list(req, res).catch(next);
});

feedbackRouter.get("/analytics", requirePermission("feedback:view"), (req, res, next) => {
  feedbackController.getAnalytics(req, res).catch(next);
});

feedbackRouter.patch("/:id/status", requirePermission("feedback:manage"), (req, res, next) => {
  feedbackController.updateStatus(req, res).catch(next);
});
