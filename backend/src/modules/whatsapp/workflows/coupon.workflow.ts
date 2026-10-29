import QRCode from "qrcode";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { MEAL_DISPLAY_NAMES } from "./menu.formatter.js";
import { couponService } from "../../coupons/coupon.service.js";
import { formatDateIST, getTodayISTString } from "../../../lib/dates-ist.js";
import { NotFoundError, BusinessRuleError } from "../../../lib/errors.js";

export interface FormattedCouponsResult {
  text: string;
  buttons?: Array<{ id: string; title: string }>;
}

export interface CouponQrResult {
  imageBuffer: Buffer;
  caption: string;
  shortCode: string;
}

export class CouponWorkflow {
  /**
   * Shows purchased and gift coupon passes (§15.2).
   */
  async listMyCoupons(studentId: string): Promise<FormattedCouponsResult> {
    const coupons = await prisma.coupon.findMany({
      where: {
        studentId,
        status: { in: ["ACTIVE", "REDEEMED"] },
      },
      orderBy: { validDate: "desc" },
      take: 10,
    });

    if (coupons.length === 0) {
      return {
        text: "🎟️ *My Coupons*\n\nYou currently have no active or recent coupons.\n\nReply *BUY* or tap below to purchase an extra meal coupon.",
        buttons: [{ id: "BUY_COUPON", title: "Buy Extra Coupon" }],
      };
    }

    const purchased = coupons.filter((c) => c.source === "PURCHASE");
    const gifts = coupons.filter((c) => c.source === "ADMIN_GIFT");

    const lines: string[] = ["🎟️ *My Campus Mess Coupons*\n"];

    if (purchased.length > 0) {
      lines.push("📋 *Purchased Meal Passes:*");
      for (const [index, c] of purchased.entries()) {
        const meta = MEAL_DISPLAY_NAMES[c.mealType] ?? { label: c.mealType, icon: "🍴" };
        const dateStr = formatDateIST(c.validDate);
        const statusBadge = c.status === "ACTIVE" ? "🟢 Valid" : "⚪ Redeemed";
        lines.push(
          `• *#${index + 1}*: ${meta.icon} *${meta.label}* on ${dateStr}\n   Code: \`${c.shortCode}\` | ${statusBadge}`,
        );
      }
      lines.push("");
    }

    if (gifts.length > 0) {
      lines.push("🎁 *Special Feast Gifts:*");
      for (const c of gifts) {
        const meta = MEAL_DISPLAY_NAMES[c.mealType] ?? { label: c.mealType, icon: "🎉" };
        const dateStr = formatDateIST(c.validDate);
        const statusBadge = c.status === "ACTIVE" ? "🟢 Valid" : "⚪ Redeemed";
        lines.push(
          `• ${meta.icon} *${meta.label}* on ${dateStr}\n   Code: \`${c.shortCode}\` | ${statusBadge}`,
        );
      }
      lines.push("");
    }

    const activeCoupons = coupons.filter((c) => c.status === "ACTIVE");
    const buttons = activeCoupons.slice(0, 3).map((c) => ({
      id: `SHOW_QR:${c.shortCode}`,
      title: `Pass ${c.shortCode}`,
    }));

    if (buttons.length === 0) {
      buttons.push({ id: "BUY_COUPON", title: "Buy Extra Coupon" });
    }

    lines.push("_Present code at dining counter or tap below to view your QR pass._");

    return {
      text: lines.join("\n").trim(),
      buttons,
    };
  }

  /**
   * Shows student's complimentary special dinner gift passes (§22.2).
   */
  async listMyGiftCoupons(studentId: string): Promise<FormattedCouponsResult> {
    const giftCoupons = await prisma.coupon.findMany({
      where: {
        studentId,
        source: "ADMIN_GIFT",
        status: { in: ["ACTIVE", "REDEEMED"] },
      },
      orderBy: { validDate: "desc" },
      take: 10,
    });

    if (giftCoupons.length === 0) {
      return {
        text: "🎁 *Special Feast Gift Passes*\n\nYou currently have no special dinner gift coupons assigned to your account.\n\nReply *MENU* to view regular meal schedules.",
        buttons: [{ id: "SHOW_TODAY_MENU", title: "View Today Menu" }],
      };
    }

    const lines: string[] = ["🎁 *My Special Feast Gift Passes:*\n"];

    for (const c of giftCoupons) {
      const dateStr = formatDateIST(c.validDate);
      const statusBadge = c.status === "ACTIVE" ? "🟢 Valid" : "⚪ Redeemed";
      lines.push(
        `• 🍽️ *Special Dinner* on ${dateStr}\n   Code: \`${c.shortCode}\` | ${statusBadge}`,
      );
    }

    const activeGifts = giftCoupons.filter((c) => c.status === "ACTIVE");
    const buttons = activeGifts.slice(0, 3).map((c) => ({
      id: `SHOW_QR:${c.shortCode}`,
      title: `Pass ${c.shortCode}`,
    }));

    lines.push("\n_Tap below or present the counter code at the dining entrance on feast night._");

    return {
      text: lines.join("\n").trim(),
      buttons,
    };
  }

  /**
   * Generates QR PNG buffer for dining counter redemption (§12, §15.3).
   * STRICT SECURITY CONTROL: QR encodes ONLY the public redemption token URL.
   * NO student name, roll number, or PII is ever embedded in the QR image.
   */
  async generateCouponQr(studentId: string, shortCodeOrRef: string): Promise<CouponQrResult> {
    const coupon = await prisma.coupon.findFirst({
      where: {
        studentId,
        shortCode: shortCodeOrRef.toUpperCase(),
      },
    });

    if (!coupon) {
      throw new NotFoundError(`Coupon '${shortCodeOrRef}' not found in your account.`);
    }

    if (coupon.status !== "ACTIVE") {
      throw new BusinessRuleError(
        "COUPON_NOT_ACTIVE",
        `Coupon ${coupon.shortCode} is ${coupon.status.toLowerCase()} and cannot be displayed for redemption.`,
      );
    }

    // Secure redemption URL: token page rate-limited against enumeration
    const qrPayload = `${env.FRONTEND_URL}/c/${coupon.shortCode}`;

    // Generate PNG buffer server-side
    const imageBuffer = await QRCode.toBuffer(qrPayload, {
      type: "png",
      width: 400,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#1e293b",
        light: "#ffffff",
      },
    });

    const meta = MEAL_DISPLAY_NAMES[coupon.mealType] ?? { label: coupon.mealType, icon: "🍴" };
    const dateStr = formatDateIST(coupon.validDate);

    const caption = [
      `🎟️ *Campus Mess Meal Pass*`,
      `Meal: *${meta.icon} ${meta.label}*`,
      `Date: *${dateStr}*`,
      `Counter Code: *\`${coupon.shortCode}\`*`,
      `\n_Show this QR code or recite code \`${coupon.shortCode}\` to mess staff at the counter scanner._`,
    ].join("\n");

    logger.info(
      { studentId, shortCode: coupon.shortCode },
      "Generated server-side coupon QR code pass",
    );

    return {
      imageBuffer,
      caption,
      shortCode: coupon.shortCode,
    };
  }

  /**
   * Initiates extra meal coupon order via CouponService (§15.4).
   * AC: NO coupon row is created until successful payment!
   */
  async initiatePurchase(
    studentId: string,
    messId: string,
    productCode: string,
    targetDateStr?: string,
  ): Promise<{ text: string; paymentUrl: string }> {
    const validDate = targetDateStr || getTodayISTString();

    const product = await prisma.couponProduct.findUnique({
      where: { messId_code: { messId, code: productCode } },
    });

    if (!product || !product.active) {
      throw new BusinessRuleError(
        "PRODUCT_UNAVAILABLE",
        "Selected coupon product is currently inactive",
      );
    }

    const idempotencyKey = `wa_order_${studentId}_${productCode}_${validDate}_${Date.now()}`;

    const order = await couponService.createOrder({
      studentId,
      productId: product.id,
      validDate,
      idempotencyKey,
    });

    const paymentUrl = `${env.FRONTEND_URL}/pay/${order.orderToken}`;
    const amountRupees = (product.pricePaise / 100).toFixed(2);
    const meta = MEAL_DISPLAY_NAMES[product.mealType] ?? { label: product.mealType, icon: "🍴" };

    const text = [
      `💳 *Order Initiated: ${meta.icon} ${meta.label} (${product.code})*`,
      `Date: *${validDate}*`,
      `Amount: *₹${amountRupees}*`,
      `\nTap the secure link below to complete payment via Razorpay. Your coupon will be instantly generated upon payment confirmation:`,
      `\n👉 ${paymentUrl}`,
      `\n_Note: This payment link will expire in 30 minutes._`,
    ].join("\n");

    return {
      text,
      paymentUrl,
    };
  }
}

export const couponWorkflow = new CouponWorkflow();
