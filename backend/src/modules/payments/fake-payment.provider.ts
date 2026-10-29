import crypto from "crypto";
import {
  PaymentProvider,
  CreatePaymentOrderInput,
  PaymentOrderResult,
  PaymentStatusResult,
} from "./payment.provider.js";

export class FakePaymentProvider implements PaymentProvider {
  public orders = new Map<string, { amount: number; receipt: string; status: string }>();
  public counter = 0;

  async createOrder(input: CreatePaymentOrderInput): Promise<PaymentOrderResult> {
    const id = `order_fake_${++this.counter}_${Date.now()}`;
    this.orders.set(id, {
      amount: input.amountPaise,
      receipt: input.receipt,
      status: "created",
    });
    return {
      id,
      amount: input.amountPaise,
      currency: "INR",
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (signature === "invalid_sig") return false;
    if (signature.startsWith("fake_sig_") || signature === "valid_webhook_sig") return true;

    // Default test verification HMAC check with mock secret
    const hmac = crypto.createHmac("sha256", "mock_webhook_secret").update(rawBody).digest("hex");
    return hmac === signature;
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (signature === "invalid_sig") return false;
    if (signature.startsWith("fake_sig_") || signature === "valid_payment_sig") return true;

    const expected = crypto
      .createHmac("sha256", "mock_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    return expected === signature;
  }

  async fetchOrderStatus(gatewayOrderId: string): Promise<PaymentStatusResult> {
    const order = this.orders.get(gatewayOrderId);
    if (!order) {
      return { status: "pending", amountPaise: 0 };
    }
    return {
      status: (order.status as "paid" | "failed" | "pending") || "paid",
      amountPaise: order.amount,
      paymentId: `pay_fake_${Date.now()}`,
    };
  }
}
