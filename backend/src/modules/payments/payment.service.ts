import { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { NotFoundError, BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { generateToken, hashToken, generateShortCode } from "../../lib/tokens.js";
import { auditService } from "../audit/audit.service.js";
import { whatsAppService } from "../whatsapp/whatsapp.service.js";
import { couponWorkflow } from "../whatsapp/workflows/coupon.workflow.js";
import { formatDateIST } from "../../lib/dates-ist.js";
import { PaymentProvider } from "./payment.provider.js";
import { RazorpayAdapter } from "./razorpay.adapter.js";

export class PaymentService {
  private provider: PaymentProvider;

  constructor(provider?: PaymentProvider) {
    this.provider = provider ?? new RazorpayAdapter();
  }

  setProvider(provider: PaymentProvider) {
    this.provider = provider;
  }

  getProvider(): PaymentProvider {
    return this.provider;
  }

  /**
   * Retrieves public checkout details by capability order token (§18.3).
   * Safe for student web page: exposes zero internal IDs or other students' data.
   */
  async getOrderDetails(orderToken: string) {
    const order = await prisma.couponOrder.findUnique({
      where: { orderToken },
      include: {
        product: {
          include: {
            mess: { select: { id: true, code: true, name: true } },
          },
        },
        student: {
          select: { id: true, name: true, rollNo: true },
        },
        coupon: {
          select: { id: true, shortCode: true, status: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundError("Payment order not found or invalid link");
    }

    const now = new Date();
    // Auto-expire order if past TTL and still pending
    if (order.status === OrderStatus.CREATED && order.expiresAt < now) {
      await prisma.couponOrder.update({
        where: { id: order.id },
        data: { status: OrderStatus.EXPIRED },
      });
      order.status = OrderStatus.EXPIRED;
    }

    return {
      orderToken: order.orderToken,
      mealType: order.product.mealType,
      productCode: order.product.code,
      validDate: formatDateIST(order.validDate),
      amountPaise: order.amountPaise,
      amountRupees: (order.amountPaise / 100).toFixed(2),
      status: order.status,
      razorpayOrderId: order.razorpayOrderId,
      razorpayKeyId: env.RAZORPAY_KEY_ID || "rzp_test_mock",
      expiresAt: order.expiresAt,
      messName: order.product.mess.name,
      studentName: order.student.name,
      coupon: order.coupon
        ? {
            shortCode: order.coupon.shortCode,
            status: order.coupon.status,
          }
        : null,
    };
  }

  /**
   * Browser client verification callback after checkout (§13, §18.3).
   * Informational check only; Webhook is authoritative source of truth.
   */
  async verifyClientPayment(
    orderToken: string,
    input: {
      razorpayPaymentId: string;
      razorpayOrderId: string;
      razorpaySignature: string;
    },
  ) {
    const order = await prisma.couponOrder.findUnique({
      where: { orderToken },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    const isValid = this.provider.verifyPaymentSignature(
      input.razorpayOrderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
    );

    if (!isValid) {
      throw new BadRequestError("Payment verification signature mismatch");
    }

    return {
      verified: true,
      status: order.status,
      message: "Payment signature verified. Coupon fulfillment processing via webhook.",
    };
  }

  /**
   * Razorpay Webhook Ingestion with replay protection and fulfillment (§13, §18.4).
   */
  async processWebhook(
    rawBody: string | Buffer,
    signature: string,
    eventId: string,
    payload: Record<string, unknown>,
  ) {
    // 1. Signature check
    const isValid = this.provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn({ eventId }, "Rejected Razorpay webhook: invalid signature");
      throw new UnauthorizedError("Invalid Razorpay webhook signature");
    }

    // 2. Replay protection (§13): Deduplicate via WebhookEvent table
    const existing = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: "razorpay",
          eventId,
        },
      },
    });

    if (existing) {
      logger.info({ eventId }, "Skipping duplicate Razorpay webhook event");
      return { received: true, duplicate: true };
    }

    await prisma.webhookEvent.create({
      data: {
        provider: "razorpay",
        eventId,
      },
    });

    const eventName = payload["event"] as string;
    logger.info({ eventId, eventName }, "Processing Razorpay webhook event");

    // 3. Process payment events
    if (eventName === "order.paid" || eventName === "payment.captured") {
      await this.handlePaymentSuccess(payload);
    } else if (eventName === "payment.failed") {
      await this.handlePaymentFailed(payload);
    }

    await prisma.webhookEvent.update({
      where: { provider_eventId: { provider: "razorpay", eventId } },
      data: { processedAt: new Date() },
    });

    return { received: true, event: eventName };
  }

  /**
   * Transactional fulfillment of successful payment (§13, §18.4).
   */
  private async handlePaymentSuccess(payload: Record<string, unknown>) {
    const eventPayload = payload["payload"] as Record<string, unknown> | undefined;
    const paymentEntity = (eventPayload?.["payment"] as Record<string, unknown> | undefined)?.[
      "entity"
    ] as Record<string, unknown> | undefined;
    const orderEntity = (eventPayload?.["order"] as Record<string, unknown> | undefined)?.[
      "entity"
    ] as Record<string, unknown> | undefined;

    const rzpOrderId = (orderEntity?.["id"] as string) || (paymentEntity?.["order_id"] as string);
    const rzpPaymentId = (paymentEntity?.["id"] as string) || "pay_unassigned";
    const amountPaise =
      (paymentEntity?.["amount"] as number) || (orderEntity?.["amount_paid"] as number) || 0;
    const currency = (paymentEntity?.["currency"] as string) || "INR";

    if (!rzpOrderId) {
      logger.warn({ payload }, "Webhook missing razorpay order ID");
      return;
    }

    await prisma.$transaction(async (tx) => {
      const order = await tx.couponOrder.findFirst({
        where: { razorpayOrderId: rzpOrderId },
        include: { product: true, coupon: true },
      });

      if (!order) {
        logger.error({ rzpOrderId }, "Webhook order ID not found in system");
        return;
      }

      // Check amount and currency match (§13)
      if (order.amountPaise !== amountPaise || currency !== "INR") {
        logger.error(
          { expected: order.amountPaise, received: amountPaise, currency },
          "Razorpay payment amount mismatch! Moving to NEEDS_REVIEW",
        );
        await tx.couponOrder.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.NEEDS_REVIEW,
            razorpayPaymentId: rzpPaymentId,
          },
        });
        await auditService.log({
          actorType: "SYSTEM",
          actorId: "RAZORPAY_WEBHOOK",
          action: "PAYMENT_AMOUNT_MISMATCH",
          entityType: "CouponOrder",
          entityId: order.id,
          after: { expected: order.amountPaise, received: amountPaise, currency },
        });
        return;
      }

      // If already fulfilled, skip duplicate fulfillment
      if (order.status === OrderStatus.PAID || order.coupon) {
        logger.info({ orderId: order.id }, "Order already paid and fulfilled");
        return;
      }

      // Update order to PAID
      await tx.couponOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAID,
          razorpayPaymentId: rzpPaymentId,
          updatedAt: new Date(),
        },
      });

      // Generate secure token and Crockford short code for dining counter
      const rawToken = generateToken(16);
      const tokenHash = hashToken(rawToken);
      const shortCode = generateShortCode(8);

      // Expiry: end of valid date 23:59:59 IST
      const validDateStr = formatDateIST(order.validDate);
      const expiresAt = new Date(`${validDateStr}T23:59:59.999Z`);

      const coupon = await tx.coupon.create({
        data: {
          messId: order.product.messId,
          studentId: order.studentId,
          productId: order.productId,
          mealType: order.product.mealType,
          validDate: order.validDate,
          source: "PURCHASE",
          status: "ACTIVE",
          tokenHash,
          shortCode,
          orderId: order.id,
          expiresAt,
        },
      });

      await auditService.log({
        actorType: "STUDENT",
        actorId: order.studentId,
        action: "COUPON_PURCHASED",
        entityType: "Coupon",
        entityId: coupon.id,
        after: {
          shortCode: coupon.shortCode,
          mealType: coupon.mealType,
          orderId: order.id,
          amountPaise: order.amountPaise,
        },
      });

      logger.info(
        { orderId: order.id, couponId: coupon.id, shortCode: coupon.shortCode },
        "Coupon fulfilled successfully after Razorpay payment",
      );

      // Enqueue "Coupon ready" WhatsApp notification with QR (§18.6)
      this.notifyStudentCouponReady(order.studentId, coupon.shortCode).catch((err) => {
        logger.error({ err, studentId: order.studentId }, "Failed to send coupon ready notice");
      });
    });
  }

  private async handlePaymentFailed(payload: Record<string, unknown>) {
    const eventPayload = payload["payload"] as Record<string, unknown> | undefined;
    const paymentEntity = (eventPayload?.["payment"] as Record<string, unknown> | undefined)?.[
      "entity"
    ] as Record<string, unknown> | undefined;

    const rzpOrderId = paymentEntity?.["order_id"] as string | undefined;
    if (!rzpOrderId) return;

    await prisma.couponOrder.updateMany({
      where: {
        razorpayOrderId: rzpOrderId,
        status: { in: [OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING] },
      },
      data: { status: OrderStatus.FAILED },
    });
  }

  /**
   * Sends "Coupon ready" WhatsApp message with QR pass (§18.6).
   */
  async notifyStudentCouponReady(studentId: string, shortCode: string): Promise<void> {
    const identity = await prisma.whatsAppIdentity.findFirst({
      where: { studentId, status: "ACTIVE" },
    });

    if (!identity) return;

    try {
      const qrResult = await couponWorkflow.generateCouponQr(studentId, shortCode);
      await whatsAppService.getProvider().sendImage(identity.phoneE164, qrResult.imageBuffer, {
        caption: `🎉 *Payment Confirmed! Your Meal Pass is Ready*\n\n${qrResult.caption}`,
      });
    } catch (err) {
      logger.error({ err, studentId, shortCode }, "Failed to send QR image notification");
    }
  }

  /**
   * Background reconciliation job for delayed webhooks (§18.5).
   */
  async reconcilePendingOrders(): Promise<{ reconciledCount: number; errors: number }> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const pendingOrders = await prisma.couponOrder.findMany({
      where: {
        status: { in: [OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING] },
        createdAt: { lte: tenMinutesAgo, gte: oneDayAgo },
        razorpayOrderId: { not: null },
      },
      take: 20,
    });

    let reconciledCount = 0;
    let errors = 0;

    for (const order of pendingOrders) {
      if (!order.razorpayOrderId || !this.provider.fetchOrderStatus) continue;

      try {
        const statusResult = await this.provider.fetchOrderStatus(order.razorpayOrderId);
        if (statusResult.status === "paid") {
          // Late paid after order expiry: if meal date has passed, send to NEEDS_REVIEW (§13)
          const todayIST = new Date(`${formatDateIST(new Date())}T00:00:00.000Z`);
          if (order.validDate < todayIST) {
            await prisma.couponOrder.update({
              where: { id: order.id },
              data: { status: OrderStatus.NEEDS_REVIEW },
            });
          } else {
            await this.handlePaymentSuccess({
              payload: {
                order: {
                  entity: {
                    id: order.razorpayOrderId,
                    amount_paid: statusResult.amountPaise,
                  },
                },
                payment: {
                  entity: {
                    id: statusResult.paymentId || "pay_reconciled",
                    order_id: order.razorpayOrderId,
                    amount: statusResult.amountPaise,
                    currency: "INR",
                  },
                },
              },
            });
            reconciledCount++;
          }
        }
      } catch (err) {
        errors++;
        logger.error({ err, orderId: order.id }, "Error during order reconciliation");
      }
    }

    return { reconciledCount, errors };
  }

  /**
   * Admin order list and NEEDS_REVIEW queue (§18.7).
   */
  async listOrders(query: {
    messId?: string;
    status?: OrderStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.CouponOrderWhereInput = {};
    if (query.messId) where.product = { messId: query.messId };
    if (query.status) where.status = query.status;

    const [total, orders] = await Promise.all([
      prisma.couponOrder.count({ where }),
      prisma.couponOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          product: true,
          student: { select: { id: true, name: true, rollNo: true, department: true } },
          coupon: { select: { id: true, shortCode: true, status: true } },
        },
      }),
    ]);

    return {
      items: orders,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async listNeedsReview(messId?: string) {
    return this.listOrders({
      messId,
      status: OrderStatus.NEEDS_REVIEW,
    });
  }
}

export const paymentService = new PaymentService();
