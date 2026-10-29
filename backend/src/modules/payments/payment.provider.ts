export interface CreatePaymentOrderInput {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}

export interface PaymentOrderResult {
  id: string;
  amount: number;
  currency: string;
}

export interface PaymentStatusResult {
  status: "paid" | "captured" | "failed" | "pending";
  amountPaise: number;
  paymentId?: string;
}

export interface PaymentProvider {
  createOrder(input: CreatePaymentOrderInput): Promise<PaymentOrderResult>;
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
  fetchOrderStatus?(gatewayOrderId: string): Promise<PaymentStatusResult>;
}
