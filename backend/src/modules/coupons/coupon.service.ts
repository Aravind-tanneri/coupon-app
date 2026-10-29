import { Prisma, CouponStatus, OrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, NotFoundError, BusinessRuleError } from "../../lib/errors.js";
import { generateToken, hashToken, generateShortCode } from "../../lib/tokens.js";
import { auditService } from "../audit/audit.service.js";
import { paymentService } from "./payment.service.js";
import {
  CreateCouponProductInput,
  UpdateCouponProductInput,
  CreateCouponOrderInput,
  CouponListQuery,
} from "./coupon.schemas.js";

export class CouponService {
  /**
   * Lists products for a mess.
   */
  async listProducts(messId: string, activeOnly = true) {
    const where: Prisma.CouponProductWhereInput = { messId };
    if (activeOnly) {
      where.active = true;
    }

    return prisma.couponProduct.findMany({
      where,
      orderBy: [{ mealType: "asc" }, { pricePaise: "asc" }],
    });
  }

  /**
   * Creates a new coupon product.
   */
  async createProduct(input: CreateCouponProductInput, actorId: string, ip?: string) {
    const existing = await prisma.couponProduct.findUnique({
      where: {
        messId_code: {
          messId: input.messId,
          code: input.code,
        },
      },
    });

    if (existing) {
      throw new BadRequestError(`Product with code '${input.code}' already exists in this mess`);
    }

    const product = await prisma.couponProduct.create({
      data: {
        messId: input.messId,
        code: input.code,
        mealType: input.mealType,
        pricePaise: input.pricePaise,
        dailyCap: input.dailyCap,
        active: input.active,
      },
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "COUPON_PRODUCT_CREATED",
      entityType: "CouponProduct",
      entityId: product.id,
      after: {
        code: product.code,
        pricePaise: product.pricePaise,
        dailyCap: product.dailyCap,
      },
      ip,
    });

    return product;
  }

  /**
   * Updates an existing coupon product.
   */
  async updateProduct(id: string, input: UpdateCouponProductInput, actorId: string, ip?: string) {
    const existing = await prisma.couponProduct.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError(`Coupon product ${id} not found`);
    }

    const updated = await prisma.couponProduct.update({
      where: { id },
      data: {
        pricePaise: input.pricePaise,
        dailyCap: input.dailyCap,
        active: input.active,
      },
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "COUPON_PRODUCT_UPDATED",
      entityType: "CouponProduct",
      entityId: id,
      before: {
        pricePaise: existing.pricePaise,
        dailyCap: existing.dailyCap,
        active: existing.active,
      },
      after: {
        pricePaise: updated.pricePaise,
        dailyCap: updated.dailyCap,
        active: updated.active,
      },
      ip,
    });

    return updated;
  }

  /**
   * Creates an order with daily cap check and Razorpay integration.
   */
  async createOrder(input: CreateCouponOrderInput) {
    const targetDate = new Date(`${input.validDate}T00:00:00.000Z`);

    // 1. Idempotency check on studentId + idempotencyKey
    const existingOrder = await prisma.couponOrder.findUnique({
      where: {
        studentId_idempotencyKey: {
          studentId: input.studentId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        product: true,
        coupon: true,
      },
    });

    if (existingOrder) {
      if (existingOrder.status !== "EXPIRED" && existingOrder.expiresAt > new Date()) {
        return existingOrder;
      }
    }

    // 2. Fetch product
    const product = await prisma.couponProduct.findUnique({
      where: { id: input.productId },
    });

    if (!product || !product.active) {
      throw new BadRequestError("Selected coupon product is unavailable or inactive");
    }

    // 3. Daily Cap Enforcement
    if (product.dailyCap !== null && product.dailyCap !== undefined) {
      const activeCouponsCount = await prisma.coupon.count({
        where: {
          productId: product.id,
          validDate: targetDate,
          status: "ACTIVE",
        },
      });

      const activePendingOrdersCount = await prisma.couponOrder.count({
        where: {
          productId: product.id,
          validDate: targetDate,
          status: { in: [OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING] },
          expiresAt: { gt: new Date() },
        },
      });

      if (activeCouponsCount + activePendingOrdersCount >= product.dailyCap) {
        throw new BusinessRuleError(
          "DAILY_CAP_REACHED",
          `The daily issuance cap of ${product.dailyCap} for this meal has been reached for ${input.validDate}.`,
        );
      }
    }

    // 4. Create Razorpay order
    const orderToken = generateToken(16);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute checkout window

    const rzpOrder = await paymentService.createRazorpayOrder(product.pricePaise, orderToken);

    const order = await prisma.couponOrder.create({
      data: {
        studentId: input.studentId,
        productId: product.id,
        validDate: targetDate,
        amountPaise: product.pricePaise,
        status: OrderStatus.CREATED,
        razorpayOrderId: rzpOrder.id,
        orderToken,
        expiresAt,
        idempotencyKey: input.idempotencyKey,
      },
      include: {
        product: true,
      },
    });

    return order;
  }

  /**
   * Fulfills an order into an active Coupon transactionally upon payment success.
   */
  async fulfillOrder(orderId: string, razorpayPaymentId: string, actorId = "SYSTEM") {
    const order = await prisma.couponOrder.findUnique({
      where: { id: orderId },
      include: { product: true, coupon: true },
    });

    if (!order) {
      throw new NotFoundError(`Order ${orderId} not found`);
    }

    if (order.coupon) {
      // Already fulfilled
      return { coupon: order.coupon, alreadyFulfilled: true };
    }

    // Generate unambiguous short code with collision retry loop
    let shortCode = "";
    let attempts = 0;
    while (attempts < 5) {
      const candidate = generateShortCode(8);
      const exists = await prisma.coupon.findUnique({
        where: { shortCode: candidate },
      });
      if (!exists) {
        shortCode = candidate;
        break;
      }
      attempts++;
    }

    if (!shortCode) {
      throw new Error("Failed to generate unique short code after 5 attempts");
    }

    const rawToken = generateToken(16);
    const tokenHash = hashToken(rawToken);

    // End of day in IST (23:59:59)
    const validDateStr = order.validDate.toISOString().split("T")[0]!;
    const couponExpiresAt = new Date(`${validDateStr}T23:59:59.999Z`);

    const result = await prisma.$transaction(async (tx) => {
      // Update order to PAID
      await tx.couponOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAID,
          razorpayPaymentId,
        },
      });

      // Create Coupon
      const coupon = await tx.coupon.create({
        data: {
          messId: order.product.messId,
          studentId: order.studentId,
          productId: order.productId,
          mealType: order.product.mealType,
          validDate: order.validDate,
          source: "PURCHASE",
          status: CouponStatus.ACTIVE,
          tokenHash,
          shortCode,
          orderId: order.id,
          expiresAt: couponExpiresAt,
        },
        include: {
          product: true,
          mess: { select: { id: true, code: true, name: true } },
          student: { select: { id: true, rollNo: true, name: true } },
        },
      });

      return coupon;
    });

    await auditService.log({
      actorType: actorId === "SYSTEM" ? "SYSTEM" : "ADMIN",
      actorId,
      action: "COUPON_ISSUED",
      entityType: "Coupon",
      entityId: result.id,
      after: {
        shortCode: result.shortCode,
        mealType: result.mealType,
        validDate: validDateStr,
        source: result.source,
        orderId: order.id,
      },
    });

    return {
      coupon: result,
      rawToken,
    };
  }

  /**
   * Verifies Razorpay checkout completion and triggers fulfillment.
   */
  async verifyAndFulfillPayment(
    orderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ) {
    const order = await prisma.couponOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundError(`Order ${orderId} not found`);
    }

    if (!order.razorpayOrderId) {
      throw new BadRequestError("Order has no Razorpay order reference");
    }

    const isValid = paymentService.verifyRazorpaySignature(
      order.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );

    if (!isValid) {
      throw new BadRequestError("Invalid Razorpay payment signature");
    }

    return this.fulfillOrder(order.id, razorpayPaymentId);
  }

  /**
   * Processes incoming Razorpay webhooks.
   */
  async handleWebhook(rawBody: string | Buffer, signature: string, payload: unknown) {
    const isValid = paymentService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new BadRequestError("Invalid webhook signature HMAC");
    }

    const event = payload as {
      event: string;
      payload?: {
        payment?: { entity: { id: string; order_id: string; status: string } };
        order?: { entity: { id: string; status: string } };
      };
    };

    if (event.event === "payment.captured" || event.event === "order.paid") {
      const rzpOrderId =
        event.payload?.payment?.entity?.order_id || event.payload?.order?.entity?.id;
      const rzpPaymentId = event.payload?.payment?.entity?.id || `pay_${Date.now()}`;

      if (rzpOrderId) {
        const order = await prisma.couponOrder.findUnique({
          where: { razorpayOrderId: rzpOrderId },
        });

        if (order && order.status !== OrderStatus.PAID) {
          await this.fulfillOrder(order.id, rzpPaymentId, "SYSTEM");
        }
      }
    }

    return { received: true };
  }

  /**
   * Queries coupons for inventory and audit with server-side pagination and filters.
   */
  async listCoupons(query: CouponListQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.CouponWhereInput = {};

    if (query.messId) where.messId = query.messId;
    if (query.studentId) where.studentId = query.studentId;
    if (query.productId) where.productId = query.productId;
    if (query.mealType) where.mealType = query.mealType;
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;

    if (query.validDate) {
      where.validDate = new Date(`${query.validDate}T00:00:00.000Z`);
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { shortCode: { contains: term.toUpperCase(), mode: "insensitive" } },
        { student: { rollNo: { contains: term, mode: "insensitive" } } },
        { student: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { id: true, code: true, pricePaise: true } },
          mess: { select: { id: true, code: true, name: true } },
          student: { select: { id: true, rollNo: true, name: true, department: true } },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Revokes an active coupon. Cannot revoke if already redeemed.
   */
  async revokeCoupon(id: string, actorId: string, messId?: string, ip?: string) {
    const coupon = await prisma.coupon.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, rollNo: true, name: true } },
        product: { select: { id: true, code: true, mealType: true } },
      },
    });

    if (!coupon) {
      throw new NotFoundError(`Coupon ${id} not found`);
    }

    if (messId && coupon.messId !== messId) {
      throw new BusinessRuleError("WRONG_MESS", "Coupon belongs to a different mess");
    }

    if (coupon.status === CouponStatus.REDEEMED) {
      throw new BusinessRuleError(
        "COUPON_ALREADY_REDEEMED",
        "Cannot revoke a coupon that has already been redeemed",
      );
    }

    if (coupon.status === CouponStatus.REVOKED) {
      return coupon;
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
      throw new BusinessRuleError(
        "CANNOT_REVOKE",
        `Cannot revoke coupon in ${coupon.status} status`,
      );
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: {
        status: CouponStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: actorId,
      },
      include: {
        student: { select: { id: true, rollNo: true, name: true } },
        product: { select: { id: true, code: true, mealType: true } },
      },
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "COUPON_REVOKED",
      entityType: "Coupon",
      entityId: id,
      before: { status: coupon.status },
      after: { status: updated.status, revokedAt: updated.revokedAt },
      ip,
    });

    return updated;
  }

  /**
   * Computes sales and inventory summary metrics.
   */
  async getInventorySummary(messId?: string, validDateStr?: string) {
    const where: Prisma.CouponWhereInput = {};
    if (messId) where.messId = messId;
    if (validDateStr) {
      where.validDate = new Date(`${validDateStr}T00:00:00.000Z`);
    }

    const [totalIssued, totalActive, totalRedeemed, totalRevoked, paidOrders] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.count({ where: { ...where, status: "ACTIVE" } }),
      prisma.coupon.count({ where: { ...where, status: "REDEEMED" } }),
      prisma.coupon.count({ where: { ...where, status: "REVOKED" } }),
      prisma.couponOrder.aggregate({
        where: {
          status: OrderStatus.PAID,
          product: messId ? { messId } : undefined,
          validDate: validDateStr ? new Date(`${validDateStr}T00:00:00.000Z`) : undefined,
        },
        _sum: { amountPaise: true },
      }),
    ]);

    return {
      totalIssued,
      totalActive,
      totalRedeemed,
      totalRevoked,
      totalRevenuePaise: paidOrders._sum.amountPaise || 0,
    };
  }
}

export const couponService = new CouponService();
