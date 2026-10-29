import crypto from "crypto";
import { env } from "../../config/env.js";

export class PaymentService {
  /**
   * Verifies standard Razorpay checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret).
   */
  verifyRazorpaySignature(
    orderId: string,
    paymentId: string,
    signature: string,
    secret = env.RAZORPAY_KEY_SECRET,
  ): boolean {
    const activeSecret = secret || "mock_secret";
    if (!secret || secret.startsWith("mock") || env.NODE_ENV === "test") {
      // In mock/test mode, accept "mock_sig_*" or valid HMAC
      if (signature.startsWith("mock_sig_")) return true;
    }

    try {
      const generated = crypto
        .createHmac("sha256", activeSecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      const expectedBuffer = Buffer.from(generated, "utf-8");
      const signatureBuffer = Buffer.from(signature, "utf-8");

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Verifies incoming Razorpay webhook signature header: HMAC-SHA256(raw_body, webhook_secret).
   */
  verifyWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
    webhookSecret = env.RAZORPAY_WEBHOOK_SECRET,
  ): boolean {
    const activeWebhookSecret = webhookSecret || "mock_webhook_secret";
    if (!webhookSecret || webhookSecret.startsWith("mock") || env.NODE_ENV === "test") {
      if (signature.startsWith("mock_webhook_sig_")) return true;
    }

    try {
      const hmac = crypto.createHmac("sha256", activeWebhookSecret);
      hmac.update(rawBody);
      const generated = hmac.digest("hex");

      const expectedBuffer = Buffer.from(generated, "utf-8");
      const signatureBuffer = Buffer.from(signature, "utf-8");

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Creates an order on Razorpay or generates a mock order ID in test/dev.
   */
  async createRazorpayOrder(
    amountPaise: number,
    receiptId: string,
  ): Promise<{ id: string; amount: number; currency: string }> {
    const isMock =
      !env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID.startsWith("mock") || env.NODE_ENV === "test";

    if (isMock) {
      return {
        id: `order_mock_${receiptId.slice(-8)}_${Date.now()}`,
        amount: amountPaise,
        currency: "INR",
      };
    }

    // Live Razorpay order creation via basic auth
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString(
      "base64",
    );
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: receiptId,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Razorpay API error: ${response.status} - ${err}`);
    }

    const data = (await response.json()) as { id: string; amount: number; currency: string };
    return data;
  }
}

export const paymentService = new PaymentService();
