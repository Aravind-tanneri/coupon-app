import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { paymentService } from "./payment.service.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";
import { BadRequestError } from "../../lib/errors.js";

export const paymentRouter = Router();

const OrderTokenParamsSchema = z.object({
  orderToken: z.string().min(1),
});

const VerifyPaymentBodySchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

const ListOrdersQuerySchema = z.object({
  status: z
    .enum(["CREATED", "PAYMENT_PENDING", "PAID", "FAILED", "EXPIRED", "NEEDS_REVIEW"])
    .optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
});

/**
 * GET /api/v1/payments/orders/:orderToken
 * Public checkout page details endpoint (§18.3).
 */
paymentRouter.get(
  "/orders/:orderToken",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderToken } = OrderTokenParamsSchema.parse(req.params);
      const details = await paymentService.getOrderDetails(orderToken);
      res.json({ success: true, data: details });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/payments/orders/:orderToken/verify
 * Browser client signature verification callback (§13, §18.3).
 */
paymentRouter.post(
  "/orders/:orderToken/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderToken } = OrderTokenParamsSchema.parse(req.params);
      const body = VerifyPaymentBodySchema.parse(req.body);
      const result = await paymentService.verifyClientPayment(orderToken, body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/payments/razorpay/webhook
 * Razorpay Webhook Ingestion (§13, §18.4).
 */
paymentRouter.post("/razorpay/webhook", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = (req.headers["x-razorpay-signature"] as string) || "";
    const eventId =
      (req.headers["x-razorpay-event-id"] as string) ||
      (req.body?.event_id as string) ||
      `evt_${Date.now()}`;

    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!signature) {
      throw new BadRequestError("Missing X-Razorpay-Signature header");
    }

    const result = await paymentService.processWebhook(
      rawBody,
      signature,
      eventId,
      req.body as Record<string, unknown>,
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/payments/admin/orders
 * Admin purchase list (§18.7).
 */
paymentRouter.get(
  "/admin/orders",
  requireAuth,
  requirePermission("coupon:view"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ListOrdersQuerySchema.parse(req.query);
      const messId = req.adminUser?.messId ?? undefined;
      const result = await paymentService.listOrders({ ...query, messId });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/v1/payments/admin/needs-review
 * Admin NEEDS_REVIEW queue (§18.7).
 */
paymentRouter.get(
  "/admin/needs-review",
  requireAuth,
  requirePermission("coupon:view"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const messId = req.adminUser?.messId ?? undefined;
      const result = await paymentService.listNeedsReview(messId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/v1/payments/admin/reconcile
 * Trigger manual or scheduled reconciliation (§18.5).
 */
paymentRouter.post(
  "/admin/reconcile",
  requireAuth,
  requirePermission("coupon:product:manage"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await paymentService.reconcilePendingOrders();
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);
