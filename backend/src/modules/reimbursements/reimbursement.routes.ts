import { Router } from "express";
import { reimbursementController } from "./reimbursement.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";

export const reimbursementRouter = Router();

// Calculation preview
reimbursementRouter.get("/calculate", (req, res, next) => {
  reimbursementController.calculate(req, res).catch(next);
});

// Admin Claims management
reimbursementRouter.get(
  "/",
  requireAuth,
  requirePermission("reimbursement:view"),
  (req, res, next) => {
    reimbursementController.listClaims(req, res).catch(next);
  },
);

reimbursementRouter.get(
  "/stats",
  requireAuth,
  requirePermission("reimbursement:view"),
  (req, res, next) => {
    reimbursementController.getStats(req, res).catch(next);
  },
);

reimbursementRouter.get(
  "/:id",
  requireAuth,
  requirePermission("reimbursement:view"),
  (req, res, next) => {
    reimbursementController.getClaim(req, res).catch(next);
  },
);

reimbursementRouter.post(
  "/:id/start-review",
  requireAuth,
  requirePermission("reimbursement:review"),
  (req, res, next) => {
    reimbursementController.startReview(req, res).catch(next);
  },
);

reimbursementRouter.post(
  "/:id/approve",
  requireAuth,
  requirePermission("reimbursement:approve"),
  (req, res, next) => {
    reimbursementController.approve(req, res).catch(next);
  },
);

reimbursementRouter.post(
  "/:id/reject",
  requireAuth,
  requirePermission("reimbursement:reject"),
  (req, res, next) => {
    reimbursementController.reject(req, res).catch(next);
  },
);

reimbursementRouter.post(
  "/:id/request-info",
  requireAuth,
  requirePermission("reimbursement:review"),
  (req, res, next) => {
    reimbursementController.requestInfo(req, res).catch(next);
  },
);

reimbursementRouter.post(
  "/:id/payments",
  requireAuth,
  requirePermission("reimbursement:pay"),
  (req, res, next) => {
    reimbursementController.recordPayment(req, res).catch(next);
  },
);

// Policy sub-routes
export const policyRouter = Router();

policyRouter.get("/", requireAuth, requirePermission("policy:view"), (req, res, next) => {
  reimbursementController.listPolicies(req, res).catch(next);
});

policyRouter.post("/", requireAuth, requirePermission("policy:manage"), (req, res, next) => {
  reimbursementController.createPolicy(req, res).catch(next);
});
