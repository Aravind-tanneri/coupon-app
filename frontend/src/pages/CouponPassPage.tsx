import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

interface CouponPassData {
  shortCode: string;
  messName: string;
  occasion: string;
  mealDate: string;
  mealType: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "REVOKED";
  expiresAt: string | null;
  redeemedAt: string | null;
}

export const CouponPassPage: React.FC = () => {
  const { couponToken } = useParams<{ couponToken: string }>();
  const [coupon, setCoupon] = useState<CouponPassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPass() {
      if (!couponToken) return;
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/c/${encodeURIComponent(couponToken)}`);
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body.message || "Invalid or expired coupon pass");
        }
        setCoupon(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load coupon pass");
      } finally {
        setLoading(false);
      }
    }

    fetchPass();
  }, [couponToken]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        {/* Header Banner */}
        <div className="bg-emerald-600 px-6 py-4 text-center">
          <h1 className="text-xl font-bold tracking-tight text-white">Campus Dining Pass</h1>
          <p className="text-xs text-emerald-100 uppercase tracking-widest mt-1">
            Official Meal Coupon
          </p>
        </div>

        <div className="p-6 space-y-6">
          {loading && (
            <div className="text-center py-10 space-y-3">
              <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-400">Verifying coupon authenticity...</p>
            </div>
          )}

          {error && !loading && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-center space-y-2">
              <p className="font-semibold text-sm">Pass Verification Failed</p>
              <p className="text-xs text-slate-400">{error}</p>
              <div className="pt-2">
                <Link
                  to="/buy"
                  className="inline-block text-xs text-emerald-400 hover:text-emerald-300 underline"
                >
                  Purchase a meal coupon
                </Link>
              </div>
            </div>
          )}

          {coupon && !loading && (
            <div className="space-y-6">
              {/* Status Badge */}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400 font-medium">Status</span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                    coupon.status === "ACTIVE"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : coupon.status === "REDEEMED"
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                        : "bg-red-500/20 text-red-400 border border-red-500/30"
                  }`}
                >
                  {coupon.status}
                </span>
              </div>

              {/* Meal & Mess Details */}
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/60 space-y-2">
                <div className="text-xs text-slate-400">Dining Hall</div>
                <div className="text-base font-semibold text-white">{coupon.messName}</div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/50">
                  <div>
                    <div className="text-xs text-slate-400">Occasion / Meal</div>
                    <div className="text-sm font-medium text-slate-200">{coupon.occasion}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Meal Date</div>
                    <div className="text-sm font-medium text-slate-200">{coupon.mealDate}</div>
                  </div>
                </div>
              </div>

              {/* Short Code Display */}
              <div className="text-center py-4 bg-slate-900/40 rounded-xl border border-dashed border-slate-700">
                <div className="text-xs uppercase text-slate-400 tracking-wider mb-1 font-mono">
                  Counter Redemption Code
                </div>
                <div className="text-3xl font-extrabold tracking-widest text-emerald-400 font-mono">
                  {coupon.shortCode}
                </div>
                <p className="text-xs text-slate-400 mt-2 px-4">
                  Present this code to the counter staff or show your WhatsApp QR pass.
                </p>
              </div>

              {coupon.status === "REDEEMED" && coupon.redeemedAt && (
                <div className="text-center text-xs text-slate-400">
                  Redeemed on{" "}
                  {new Date(coupon.redeemedAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-900/80 px-6 py-3 border-t border-slate-700/50 text-center">
          <p className="text-xs text-slate-500">Campus Mess Coupon System • Zero-PII Pass</p>
        </div>
      </div>
    </div>
  );
};
