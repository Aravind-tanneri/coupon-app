import { Request, Response } from "express";
import { couponService } from "./coupon.service.js";
import {
  CreateCouponProductSchema,
  UpdateCouponProductSchema,
  CreateCouponOrderSchema,
  VerifyPaymentSchema,
  CouponListQuerySchema,
} from "./coupon.schemas.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";

export class CouponController {
  async listProducts(req: Request, res: Response) {
    const messId = (req.query.messId as string) || req.adminUser?.messId;
    if (!messId) {
      throw new BadRequestError("messId is required to list products");
    }

    const activeOnly = req.query.activeOnly !== "false";
    const products = await couponService.listProducts(messId, activeOnly);

    res.status(200).json({
      success: true,
      data: products,
    });
  }

  async createProduct(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const input = CreateCouponProductSchema.parse(req.body);

    if (
      req.adminUser.role !== "SUPER_ADMIN" &&
      req.adminUser.messId &&
      input.messId !== req.adminUser.messId
    ) {
      throw new UnauthorizedError("You do not have access to manage products for this mess");
    }

    const product = await couponService.createProduct(input, req.adminUser.id, req.ip);

    res.status(201).json({
      success: true,
      data: product,
    });
  }

  async updateProduct(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      throw new BadRequestError("Product ID is required");
    }

    const input = UpdateCouponProductSchema.parse(req.body);

    const updated = await couponService.updateProduct(id, input, req.adminUser.id, req.ip);

    res.status(200).json({
      success: true,
      data: updated,
    });
  }

  async createOrder(req: Request, res: Response) {
    const input = CreateCouponOrderSchema.parse(req.body);
    const order = await couponService.createOrder(input);

    res.status(201).json({
      success: true,
      data: order,
    });
  }

  async verifyPayment(req: Request, res: Response) {
    const input = VerifyPaymentSchema.parse(req.body);

    const result = await couponService.verifyAndFulfillPayment(
      input.orderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async webhook(req: Request, res: Response) {
    const signature = (req.headers["x-razorpay-signature"] as string) || "";
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const result = await couponService.handleWebhook(rawBody, signature, req.body);

    res.status(200).json(result);
  }

  async listCoupons(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const query = CouponListQuerySchema.parse(req.query);

    if (req.adminUser.role !== "SUPER_ADMIN" && req.adminUser.messId) {
      query.messId = req.adminUser.messId;
    }

    const result = await couponService.listCoupons(query);

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  async revokeCoupon(req: Request, res: Response) {
    if (!req.adminUser) {
      throw new UnauthorizedError();
    }

    const idParam = req.params.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!id) {
      throw new BadRequestError("Coupon ID is required");
    }

    const messId =
      req.adminUser.role === "SUPER_ADMIN" ? undefined : (req.adminUser.messId ?? undefined);

    const result = await couponService.revokeCoupon(id, req.adminUser.id, messId, req.ip);

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

    const validDate = req.query.validDate as string | undefined;

    const summary = await couponService.getInventorySummary(targetMessId, validDate);

    res.status(200).json({
      success: true,
      data: summary,
    });
  }

  async getPublicCoupon(req: Request, res: Response) {
    const tokenParam = req.params.token;
    const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
    if (!token) {
      throw new BadRequestError("Token is required");
    }

    const data = await couponService.getPublicCoupon(token);
    res.status(200).json({
      success: true,
      data,
    });
  }
}

export const couponController = new CouponController();
