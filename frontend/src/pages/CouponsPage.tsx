import React, { useState, useEffect, useCallback } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/common/Toast";
import { DataTable, Column } from "../components/common/DataTable";
import { StatusBadge } from "../components/common/StatusBadge";
import { CurrencyDisplay } from "../components/common/CurrencyDisplay";
import { ISTDateDisplay } from "../components/common/ISTDateDisplay";
import { Modal } from "../components/common/Modal";
import {
  Ticket,
  Plus,
  RefreshCw,
  ShoppingBag,
  Filter,
  CheckCircle2,
  QrCode,
  IndianRupee,
  Layers,
  Edit2,
} from "lucide-react";

type MealType = "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER" | "SPECIAL_DINNER";

interface CouponProduct {
  id: string;
  messId: string;
  code: string;
  mealType: MealType;
  pricePaise: number;
  active: boolean;
  dailyCap: number | null;
  createdAt: string;
}

interface CouponItem {
  id: string;
  shortCode: string;
  mealType: MealType;
  validDate: string;
  source: "PURCHASE" | "ADMIN_GIFT";
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "REVOKED";
  createdAt: string;
  product: { id: string; code: string; pricePaise: number } | null;
  student: { id: string; rollNo: string; name: string; department: string };
  mess: { id: string; code: string; name: string };
}

interface InventorySummary {
  totalIssued: number;
  totalActive: number;
  totalRedeemed: number;
  totalRevoked: number;
  totalRevenuePaise: number;
}

interface CouponListResponse {
  items: CouponItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const CouponsPage: React.FC = () => {
  const { user, can } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"inventory" | "products">("inventory");

  // Summary metrics
  const [summary, setSummary] = useState<InventorySummary | null>(null);

  // Products state
  const [products, setProducts] = useState<CouponProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState<boolean>(false);

  // Coupons table state
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [couponsLoading, setCouponsLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [mealFilter, setMealFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Add / Edit Product Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<CouponProduct | null>(null);
  const [productForm, setProductForm] = useState({
    code: "",
    mealType: "LUNCH" as MealType,
    priceRupees: "80",
    dailyCap: "",
    active: true,
  });
  const [savingProduct, setSavingProduct] = useState<boolean>(false);

  // Quick Purchase / Issue Modal State
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState<boolean>(false);
  const [purchaseForm, setPurchaseForm] = useState({
    studentRoll: "",
    productId: "",
    validDate: new Date().toISOString().split("T")[0]!,
  });
  const [purchasing, setPurchasing] = useState<boolean>(false);
  const [issuedCouponResult, setIssuedCouponResult] = useState<{
    shortCode: string;
    token: string;
    mealType: string;
    validDate: string;
  } | null>(null);

  // Fetch Inventory Summary
  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.get<InventorySummary>("/coupons/summary", {
        messId: user?.messId || undefined,
      });
      setSummary(data);
    } catch {
      // Non-fatal
    }
  }, [user?.messId]);

  // Fetch Products
  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const data = await api.get<CouponProduct[]>("/coupons/products", {
        messId: user?.messId || "default",
        activeOnly: false,
      });
      setProducts(data);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Failed to load products", err.message);
      }
    } finally {
      setProductsLoading(false);
    }
  }, [user?.messId, toast]);

  // Fetch Coupons
  const fetchCoupons = useCallback(async () => {
    setCouponsLoading(true);
    try {
      const data = await api.get<CouponListResponse>("/coupons", {
        search: search || undefined,
        mealType: mealFilter || undefined,
        status: statusFilter || undefined,
        messId: user?.messId || undefined,
        page,
        pageSize: 15,
      });
      setCoupons(data.items);
      setTotalPages(data.totalPages);
      setTotalItems(data.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Failed to load coupons", err.message);
      }
    } finally {
      setCouponsLoading(false);
    }
  }, [search, mealFilter, statusFilter, user?.messId, page, toast]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (activeTab === "products") {
      fetchProducts();
    } else {
      fetchCoupons();
    }
  }, [activeTab, fetchProducts, fetchCoupons]);

  // Handle Save Product (Create or Update)
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);

    try {
      const pricePaise = Math.round(parseFloat(productForm.priceRupees || "0") * 100);
      const dailyCap = productForm.dailyCap ? parseInt(productForm.dailyCap, 10) : undefined;

      if (editingProduct) {
        await api.patch(`/coupons/products/${editingProduct.id}`, {
          pricePaise,
          dailyCap: dailyCap ?? null,
          active: productForm.active,
        });
        toast.success("Product Updated", `Product ${editingProduct.code} updated successfully.`);
      } else {
        await api.post("/coupons/products", {
          messId: user?.messId || "default",
          code: productForm.code.trim().toUpperCase(),
          mealType: productForm.mealType,
          pricePaise,
          dailyCap,
          active: productForm.active,
        });
        toast.success("Product Created", `Product ${productForm.code} added to catalog.`);
      }

      setIsProductModalOpen(false);
      setEditingProduct(null);
      fetchProducts();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Save Failed", err.message);
      }
    } finally {
      setSavingProduct(false);
    }
  };

  // Open Edit Product
  const handleEditProduct = (p: CouponProduct) => {
    setEditingProduct(p);
    setProductForm({
      code: p.code,
      mealType: p.mealType,
      priceRupees: (p.pricePaise / 100).toFixed(2),
      dailyCap: p.dailyCap ? String(p.dailyCap) : "",
      active: p.active,
    });
    setIsProductModalOpen(true);
  };

  // Quick Purchase Simulation
  const handleQuickPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setPurchasing(true);
    setIssuedCouponResult(null);

    try {
      // 1. Resolve student by roll or ID
      const studentsRes = await api.get<{ items: Array<{ id: string; rollNo: string }> }>(
        "/students",
        {
          search: purchaseForm.studentRoll.trim(),
          pageSize: 1,
        },
      );

      const targetStudent = studentsRes.items[0];
      if (!targetStudent) {
        toast.error("Student Not Found", `No student found matching '${purchaseForm.studentRoll}'`);
        setPurchasing(false);
        return;
      }

      // 2. Create Order
      const idempotencyKey = `quick_buy_${targetStudent.id}_${Date.now()}`;
      const order = await api.post<{ id: string; razorpayOrderId?: string }>("/coupons/orders", {
        studentId: targetStudent.id,
        productId: purchaseForm.productId,
        validDate: purchaseForm.validDate,
        idempotencyKey,
      });

      // 3. Complete Payment (Dev mock verification)
      const fulfillRes = await api.post<{
        coupon: { shortCode: string; mealType: string; validDate: string };
        rawToken: string;
      }>("/coupons/verify-payment", {
        orderId: order.id,
        razorpayPaymentId: `pay_mock_${Date.now()}`,
        razorpaySignature: "mock_sig_valid",
      });

      setIssuedCouponResult({
        shortCode: fulfillRes.coupon.shortCode,
        token: fulfillRes.rawToken,
        mealType: fulfillRes.coupon.mealType,
        validDate: fulfillRes.coupon.validDate.split("T")[0]!,
      });

      toast.success("Coupon Purchased", `Issued short code: ${fulfillRes.coupon.shortCode}`);
      fetchSummary();
      fetchCoupons();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Purchase Failed", err.message);
      }
    } finally {
      setPurchasing(false);
    }
  };

  const couponColumns: Column<CouponItem>[] = [
    {
      key: "shortCode",
      header: "Short Code",
      render: (c) => (
        <span className="font-mono font-bold tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
          {c.shortCode}
        </span>
      ),
    },
    {
      key: "student",
      header: "Student",
      render: (c) => (
        <div>
          <p className="font-medium text-slate-800">{c.student.name}</p>
          <p className="text-xs text-slate-400 font-mono">{c.student.rollNo}</p>
        </div>
      ),
    },
    {
      key: "mealType",
      header: "Meal",
      render: (c) => (
        <span className="text-xs font-semibold text-slate-700">{c.mealType.replace("_", " ")}</span>
      ),
    },
    {
      key: "validDate",
      header: "Valid Date",
      render: (c) => (
        <ISTDateDisplay date={c.validDate} format="date" className="text-xs text-slate-600" />
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (c) => (
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
          {c.source.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: "createdAt",
      header: "Issued",
      render: (c) => (
        <ISTDateDisplay date={c.createdAt} format="short" className="text-xs text-slate-400" />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Coupon Inventory & Catalog
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage meal coupon pricing, daily quotas, and monitor active issuance & redemption.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setPurchaseForm({
                studentRoll: "",
                productId: products[0]?.id || "",
                validDate: new Date().toISOString().split("T")[0]!,
              });
              setIssuedCouponResult(null);
              setIsPurchaseModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors"
          >
            <ShoppingBag className="w-4 h-4 text-emerald-600" />
            <span>Buy / Issue Coupon</span>
          </button>

          {can("coupon:product:manage") && (
            <button
              onClick={() => {
                setEditingProduct(null);
                setProductForm({
                  code: "",
                  mealType: "LUNCH",
                  priceRupees: "80",
                  dailyCap: "",
                  active: true,
                });
                setIsProductModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm transition-colors focus:outline-none"
            >
              <Plus className="w-4 h-4" />
              <span>New Product</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Issued</span>
              <Ticket className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-2xl font-bold text-slate-900 mt-2">{summary.totalIssued}</p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Today</span>
              <CheckCircle2 className="w-4 h-4 text-sky-600" />
            </div>
            <p className="text-2xl font-bold text-sky-700 mt-2">{summary.totalActive}</p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Redeemed</span>
              <QrCode className="w-4 h-4 text-slate-600" />
            </div>
            <p className="text-2xl font-bold text-slate-700 mt-2">{summary.totalRedeemed}</p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Revoked</span>
              <Layers className="w-4 h-4 text-rose-500" />
            </div>
            <p className="text-2xl font-bold text-slate-700 mt-2">{summary.totalRevoked}</p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Sales</span>
              <IndianRupee className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-2xl font-bold text-emerald-700 mt-2">
              <CurrencyDisplay paise={summary.totalRevenuePaise} />
            </p>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab("inventory")}
          className={`pb-3 border-b-2 transition-colors ${
            activeTab === "inventory"
              ? "border-emerald-600 text-emerald-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Active & Past Coupons
        </button>
        <button
          onClick={() => setActiveTab("products")}
          className={`pb-3 border-b-2 transition-colors ${
            activeTab === "products"
              ? "border-emerald-600 text-emerald-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Product Catalog
        </button>
      </div>

      {/* Tab 1: Coupons Inventory */}
      {activeTab === "inventory" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm text-xs">
            <div className="flex items-center gap-1.5 text-slate-500 font-semibold uppercase tracking-wider">
              <Filter className="w-3.5 h-3.5" />
              <span>Filter:</span>
            </div>

            <select
              value={mealFilter}
              onChange={(e) => {
                setMealFilter(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none"
            >
              <option value="">All Meals</option>
              <option value="BREAKFAST">Breakfast</option>
              <option value="LUNCH">Lunch</option>
              <option value="SNACKS">Snacks</option>
              <option value="DINNER">Dinner</option>
              <option value="SPECIAL_DINNER">Special Dinner</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="REDEEMED">Redeemed</option>
              <option value="EXPIRED">Expired</option>
              <option value="REVOKED">Revoked</option>
            </select>

            <button
              onClick={() => fetchCoupons()}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 ml-auto"
              title="Refresh coupons"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${couponsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Coupons Table */}
          <DataTable
            columns={couponColumns}
            data={coupons}
            loading={couponsLoading}
            search={search}
            onSearchChange={(val) => {
              setSearch(val);
              setPage(1);
            }}
            searchPlaceholder="Search short code or roll number..."
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={(p) => setPage(p)}
            emptyMessage="No coupons found matching your criteria."
          />
        </div>
      )}

      {/* Tab 2: Product Catalog */}
      {activeTab === "products" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm animate-pulse space-y-3"
              >
                <div className="h-4 bg-slate-200 rounded w-1/3" />
                <div className="h-6 bg-slate-200 rounded w-1/2" />
                <div className="h-4 bg-slate-200 rounded w-3/4" />
              </div>
            ))
          ) : products.length === 0 ? (
            <div className="col-span-full p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-400">
              No products found in this mess catalog.
            </div>
          ) : (
            products.map((p) => (
              <div
                key={p.id}
                className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 text-sm">{p.code}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        p.active
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-500 border border-slate-200"
                      }`}
                    >
                      {p.active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Meal: <strong className="text-slate-700">{p.mealType.replace("_", " ")}</strong>
                  </p>

                  <div className="mt-3">
                    <span className="text-2xl font-extrabold text-slate-900">
                      <CurrencyDisplay paise={p.pricePaise} />
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2">
                    <span>Daily Cap:</span>
                    <strong className="text-slate-800">
                      {p.dailyCap ? `${p.dailyCap} coupons` : "Unlimited"}
                    </strong>
                  </div>
                </div>

                {can("coupon:product:manage") && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={() => handleEditProduct(p)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Product</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {isProductModalOpen && (
        <Modal
          isOpen={isProductModalOpen}
          onClose={() => setIsProductModalOpen(false)}
          title={editingProduct ? `Edit ${editingProduct.code}` : "Add Coupon Product"}
          description="Define meal type, price in INR, and daily purchase cap."
          maxWidth="md"
        >
          <form onSubmit={handleSaveProduct} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                Product Code
              </label>
              <input
                type="text"
                required
                disabled={Boolean(editingProduct)}
                value={productForm.code}
                onChange={(e) => setProductForm({ ...productForm, code: e.target.value })}
                placeholder="e.g. SPECIAL_LUNCH"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 uppercase font-mono disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                Meal Type
              </label>
              <select
                disabled={Boolean(editingProduct)}
                value={productForm.mealType}
                onChange={(e) =>
                  setProductForm({ ...productForm, mealType: e.target.value as MealType })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white disabled:bg-slate-100"
              >
                <option value="BREAKFAST">Breakfast</option>
                <option value="LUNCH">Lunch</option>
                <option value="SNACKS">Snacks</option>
                <option value="DINNER">Dinner</option>
                <option value="SPECIAL_DINNER">Special Dinner</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                Price (₹ INR)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  required
                  value={productForm.priceRupees}
                  onChange={(e) => setProductForm({ ...productForm, priceRupees: e.target.value })}
                  placeholder="80.00"
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                Daily Cap (Optional)
              </label>
              <input
                type="number"
                min="1"
                value={productForm.dailyCap}
                onChange={(e) => setProductForm({ ...productForm, dailyCap: e.target.value })}
                placeholder="Leave blank for unlimited"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="activeToggle"
                checked={productForm.active}
                onChange={(e) => setProductForm({ ...productForm, active: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
              />
              <label htmlFor="activeToggle" className="text-sm font-medium text-slate-700">
                Active for purchase
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsProductModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProduct}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingProduct ? "Saving..." : "Save Product"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Quick Purchase / Issue Modal */}
      {isPurchaseModalOpen && (
        <Modal
          isOpen={isPurchaseModalOpen}
          onClose={() => setIsPurchaseModalOpen(false)}
          title="Issue / Purchase Meal Coupon"
          description="Purchase a meal coupon for a student with immediate Crockford Base32 short code & QR issuance."
          maxWidth="md"
        >
          {issuedCouponResult ? (
            <div className="space-y-5 text-center py-2">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900">Coupon Issued Successfully</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Valid for <strong>{issuedCouponResult.mealType}</strong> on{" "}
                  <strong>{issuedCouponResult.validDate}</strong>
                </p>
              </div>

              {/* Short code card */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 max-w-xs mx-auto">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Short Code
                </p>
                <p className="text-3xl font-mono font-extrabold text-emerald-700 mt-1 tracking-wider">
                  {issuedCouponResult.shortCode}
                </p>
                <div className="mt-3 p-2 bg-white rounded border border-slate-200 inline-flex items-center gap-2 text-xs font-mono text-slate-500">
                  <QrCode className="w-4 h-4 text-slate-600" />
                  <span>Token: {issuedCouponResult.token.slice(0, 8)}...</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIssuedCouponResult(null);
                  setIsPurchaseModalOpen(false);
                }}
                className="w-full py-2 px-4 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-900"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleQuickPurchase} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Student Roll Number
                </label>
                <input
                  type="text"
                  required
                  value={purchaseForm.studentRoll}
                  onChange={(e) =>
                    setPurchaseForm({ ...purchaseForm, studentRoll: e.target.value })
                  }
                  placeholder="e.g. CS101"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Select Product
                </label>
                <select
                  required
                  value={purchaseForm.productId}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, productId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 bg-white"
                >
                  <option value="">Select a meal coupon</option>
                  {products
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.mealType} (₹{(p.pricePaise / 100).toFixed(2)})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Valid Date
                </label>
                <input
                  type="date"
                  required
                  value={purchaseForm.validDate}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, validDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPurchaseModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={purchasing || !purchaseForm.productId}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                >
                  {purchasing ? "Issuing..." : "Complete Purchase"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
};
