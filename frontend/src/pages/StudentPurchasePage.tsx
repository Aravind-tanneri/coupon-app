import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import { CurrencyDisplay } from "../components/common/CurrencyDisplay";
import { Utensils, QrCode, CheckCircle2, Calendar, AlertCircle, ArrowRight } from "lucide-react";

interface ProductOption {
  id: string;
  code: string;
  mealType: string;
  pricePaise: number;
  active: boolean;
  dailyCap: number | null;
}

export const StudentPurchasePage: React.FC = () => {
  const [searchParams] = useSearchParams();

  const [rollNo, setRollNo] = useState<string>(searchParams.get("roll") || "");
  const messId = searchParams.get("messId") || "default";
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [validDate, setValidDate] = useState<string>(() => new Date().toISOString().split("T")[0]!);

  const [loadingProducts, setLoadingProducts] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Issued Coupon Result
  const [issuedCoupon, setIssuedCoupon] = useState<{
    shortCode: string;
    token: string;
    mealType: string;
    validDate: string;
  } | null>(null);

  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      setError(null);
      try {
        const data = await api.get<ProductOption[]>("/coupons/products", {
          messId: messId || "default",
          activeOnly: true,
        });
        setProducts(data);
        if (data.length > 0) {
          setSelectedProductId(data[0]!.id);
        }
      } catch (err) {
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError("Failed to load available meal options.");
        }
      } finally {
        setLoadingProducts(false);
      }
    }
    loadProducts();
  }, [messId]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProcessing(true);

    try {
      // 1. Resolve student by roll number
      const studentsRes = await api.get<{
        items: Array<{ id: string; rollNo: string; name: string }>;
      }>("/students", {
        search: rollNo.trim(),
        pageSize: 1,
      });

      const student = studentsRes.items[0];
      if (!student) {
        throw new Error(`Student with Roll Number '${rollNo}' was not found in directory.`);
      }

      // 2. Create Order
      const idempotencyKey = `web_buy_${student.id}_${Date.now()}`;
      const order = await api.post<{ id: string; razorpayOrderId?: string }>("/coupons/orders", {
        studentId: student.id,
        productId: selectedProductId,
        validDate,
        idempotencyKey,
      });

      // 3. Fulfill Payment (dev mock adapter)
      const fulfillRes = await api.post<{
        coupon: { shortCode: string; mealType: string; validDate: string };
        rawToken: string;
      }>("/coupons/verify-payment", {
        orderId: order.id,
        razorpayPaymentId: `pay_web_${Date.now()}`,
        razorpaySignature: "mock_sig_valid",
      });

      setIssuedCoupon({
        shortCode: fulfillRes.coupon.shortCode,
        token: fulfillRes.rawToken,
        mealType: fulfillRes.coupon.mealType,
        validDate: fulfillRes.coupon.validDate.split("T")[0]!,
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred during checkout.");
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-md">
            <Utensils className="w-6 h-6" />
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            Instant Meal Coupon
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Campus Mess self-service portal & instant counter redemption
          </p>
        </div>

        <div className="mt-6 bg-white py-6 px-4 shadow-sm border border-slate-200 rounded-xl sm:px-8">
          {error && (
            <div className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {issuedCoupon ? (
            /* Issued Coupon Success Screen */
            <div className="text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900">Coupon Confirmed</h3>
                <p className="text-xs text-slate-500">
                  {issuedCoupon.mealType.replace("_", " ")} • {issuedCoupon.validDate}
                </p>
              </div>

              {/* Short code card */}
              <div className="p-5 bg-emerald-50/50 rounded-xl border border-emerald-200">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block">
                  Show at Counter
                </span>
                <span className="text-3xl font-mono font-extrabold text-emerald-700 tracking-wider block mt-1">
                  {issuedCoupon.shortCode}
                </span>
                <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <QrCode className="w-4 h-4 text-slate-400" />
                  <span className="font-mono text-[11px]">
                    Token: {issuedCoupon.token.slice(0, 10)}...
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-400 text-left bg-slate-50 p-3 rounded-lg border border-slate-200">
                <p className="font-semibold text-slate-700 mb-1">Redemption Instructions:</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Show this 8-character code or QR to the mess staff.</li>
                  <li>Coupons are single-use and expire at the end of the meal window.</li>
                </ol>
              </div>

              <button
                type="button"
                onClick={() => setIssuedCoupon(null)}
                className="w-full py-2 px-4 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Purchase Another
              </button>
            </div>
          ) : (
            /* Purchase Form */
            <form onSubmit={handlePurchase} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Student Roll Number
                </label>
                <input
                  type="text"
                  required
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value)}
                  placeholder="e.g. CS101"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Meal Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={validDate}
                    onChange={(e) => setValidDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900"
                  />
                  <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Select Meal Coupon
                </label>
                {loadingProducts ? (
                  <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-400 animate-pulse">
                    Loading available coupons...
                  </div>
                ) : products.length === 0 ? (
                  <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-400">
                    No active coupon products available right now.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {products.map((p) => (
                      <label
                        key={p.id}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedProductId === p.id
                            ? "border-emerald-500 bg-emerald-50/30 ring-1 ring-emerald-500"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="mealProduct"
                            checked={selectedProductId === p.id}
                            onChange={() => setSelectedProductId(p.id)}
                            className="text-emerald-600 focus:ring-emerald-500"
                          />
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{p.code}</p>
                            <p className="text-xs text-slate-500">{p.mealType.replace("_", " ")}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-slate-900">
                            <CurrencyDisplay paise={p.pricePaise} />
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {selectedProduct && (
                <div className="p-3 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                  <span className="text-slate-500">Amount Due:</span>
                  <span className="font-bold text-base text-slate-900">
                    <CurrencyDisplay paise={selectedProduct.pricePaise} />
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={processing || !selectedProductId || !rollNo}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-colors"
              >
                {processing ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Pay & Receive Coupon</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
