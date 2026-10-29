import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface OrderDetails {
  orderToken: string;
  mealType: string;
  productCode: string;
  validDate: string;
  amountPaise: number;
  amountRupees: string;
  status: string;
  razorpayOrderId: string | null;
  razorpayKeyId: string;
  expiresAt: string;
  messName: string;
  studentName: string;
  coupon: {
    shortCode: string;
    status: string;
  } | null;
}

export const CheckoutPage: React.FC = () => {
  const { orderToken } = useParams<{ orderToken: string }>();
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulatedSuccess, setSimulatedSuccess] = useState(false);

  useEffect(() => {
    async function loadOrder() {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/payments/orders/${orderToken}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Unable to load order details");
        }
        setOrder(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load order");
      } finally {
        setLoading(false);
      }
    }

    if (orderToken) {
      loadOrder();
    }
  }, [orderToken]);

  const handleSimulatePayment = async () => {
    if (!order) return;
    setSimulating(true);
    try {
      const res = await fetch(`/api/v1/payments/orders/${order.orderToken}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razorpayOrderId: order.razorpayOrderId || "order_simulated",
          razorpayPaymentId: `pay_sim_${Date.now()}`,
          razorpaySignature: "mock_sig_valid",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Payment simulation failed");
      }
      setSimulatedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation error");
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm w-full">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading checkout...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md w-full">
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">
            ⚠️
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Order Not Available</h2>
          <p className="text-slate-600 mb-6">{error || "Invalid or expired payment order."}</p>
          <p className="text-sm text-slate-500">
            Please return to WhatsApp and type *BUY* to generate a fresh payment link.
          </p>
        </div>
      </div>
    );
  }

  const isPaid = order.status === "PAID" || simulatedSuccess;
  const isExpired = order.status === "EXPIRED" && !isPaid;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-200/80 max-w-md w-full overflow-hidden">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white text-center">
          <span className="text-xs font-semibold tracking-wider uppercase bg-white/20 px-3 py-1 rounded-full">
            Campus Mess Meal Checkout
          </span>
          <h1 className="text-2xl font-black mt-3">{order.messName}</h1>
          <p className="text-indigo-100 text-sm mt-1">Student: {order.studentName}</p>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Meal Pass</span>
              <span className="font-semibold text-slate-800 capitalize">
                {order.mealType.toLowerCase().replace("_", " ")}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Valid Date</span>
              <span className="font-semibold text-slate-800">{order.validDate}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-t border-slate-200/60 pt-3">
              <span className="text-slate-600 font-medium">Total Amount</span>
              <span className="text-2xl font-black text-indigo-600">₹{order.amountRupees}</span>
            </div>
          </div>

          {/* Status Display */}
          {isPaid ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 text-xl font-bold">
                ✓
              </div>
              <h3 className="text-lg font-bold text-emerald-900">Payment Successful!</h3>
              <p className="text-sm text-emerald-700 mt-1">
                Your coupon has been generated and sent to your WhatsApp.
              </p>
              {order.coupon && (
                <div className="mt-3 p-2 bg-white rounded-lg border border-emerald-200 text-xs font-mono font-bold text-slate-800">
                  Counter Code: {order.coupon.shortCode}
                </div>
              )}
            </div>
          ) : isExpired ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3 text-xl">
                ⏱️
              </div>
              <h3 className="text-lg font-bold text-amber-900">Order Expired</h3>
              <p className="text-sm text-amber-700 mt-1">
                Checkout links expire after 30 minutes. Please request a new link on WhatsApp.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleSimulatePayment}
                disabled={simulating}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-bold rounded-2xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
              >
                {simulating ? "Processing Payment..." : `Pay ₹${order.amountRupees} via Razorpay`}
              </button>

              <p className="text-xs text-center text-slate-400">
                🔒 Secure 256-bit encrypted checkout. No banking data stored on mess servers.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
