import { Router } from "express";
import { couponController } from "./coupon.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";

export const couponRouter = Router();

// Public / Student endpoints
couponRouter.get("/products", (req, res, next) => {
  couponController.listProducts(req, res).catch(next);
});

couponRouter.post("/orders", (req, res, next) => {
  couponController.createOrder(req, res).catch(next);
});

couponRouter.post("/verify-payment", (req, res, next) => {
  couponController.verifyPayment(req, res).catch(next);
});

couponRouter.post("/webhook", (req, res, next) => {
  couponController.webhook(req, res).catch(next);
});

// Admin-protected endpoints
couponRouter.post(
  "/products",
  requireAuth,
  requirePermission("coupon:product:manage"),
  (req, res, next) => {
    couponController.createProduct(req, res).catch(next);
  },
);

couponRouter.patch(
  "/products/:id",
  requireAuth,
  requirePermission("coupon:product:manage"),
  (req, res, next) => {
    couponController.updateProduct(req, res).catch(next);
  },
);

couponRouter.get("/", requireAuth, requirePermission("coupon:view"), (req, res, next) => {
  couponController.listCoupons(req, res).catch(next);
});

couponRouter.get("/summary", requireAuth, requirePermission("coupon:view"), (req, res, next) => {
  couponController.getSummary(req, res).catch(next);
});
