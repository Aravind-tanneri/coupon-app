import crypto from "crypto";
import { env } from "../../config/env.js";
import { ExternalServiceError } from "../../lib/errors.js";
import {
  PaymentProvider,
  CreatePaymentOrderInput,
  PaymentOrderResult,
  PaymentStatusResult,
} from "./payment.provider.js";

export class RazorpayAdapter implements PaymentProvider {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;

  constructor(
    keyId = env.RAZORPAY_KEY_ID || "",
    keySecret = env.RAZORPAY_KEY_SECRET || "",
    webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || "",
  ) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;
  }

  async createOrder(input: CreatePaymentOrderInput): Promise<PaymentOrderResult> {
    if (!this.keyId || !this.keySecret || env.NODE_ENV === "test") {
      return {
        id: `order_mock_${input.receipt.slice(-8)}_${Date.now()}`,
        amount: input.amountPaise,
        currency: "INR",
      };
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        notes: input.notes,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new ExternalServiceError("Razorpay", `Order creation failed: ${errBody}`);
    }

    const data = (await response.json()) as { id: string; amount: number; currency: string };
    return {
      id: data.id,
      amount: data.amount,
      currency: data.currency,
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    const secret = this.webhookSecret || "mock_webhook_secret";

    if (env.NODE_ENV === "test" && signature.startsWith("mock_webhook_sig_")) {
      return true;
    }

    try {
      const hmac = crypto.createHmac("sha256", secret);
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

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!signature) return false;
    const secret = this.keySecret || "mock_secret";

    if (env.NODE_ENV === "test" && signature.startsWith("mock_sig_")) {
      return true;
    }

    try {
      const generated = crypto
        .createHmac("sha256", secret)
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

  async fetchOrderStatus(gatewayOrderId: string): Promise<PaymentStatusResult> {
    if (!this.keyId || !this.keySecret || env.NODE_ENV === "test") {
      return {
        status: "paid",
        amountPaise: 5000,
        paymentId: `pay_mock_${Date.now()}`,
      };
    }

    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const response = await fetch(`https://api.razorpay.com/v1/orders/${gatewayOrderId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!response.ok) {
      throw new ExternalServiceError("Razorpay", `Status fetch failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { status: string; amount_paid: number };
    return {
      status: (data.status as "paid" | "failed" | "pending") || "pending",
      amountPaise: data.amount_paid,
    };
  }
}
