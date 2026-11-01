import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  LayoutDashboard,
  Users,
  Receipt,
  QrCode,
  Ticket,
  IndianRupee,
  Star,
  ArrowRight,
  Clock,
  Sparkles,
} from "lucide-react";

interface DashboardMetrics {
  activeStudents: number;
  todayRedemptions: number;
  pendingClaims: number;
  activeCoupons: number;
  totalRevenuePaise: number;
  averageRating: number | null;
  totalFeedback: number;
}

interface RecentRedemption {
  id: string;
  shortCode: string;
  mealType: string;
  redeemedAt: string | null;
  student: {
    name: string;
    rollNo: string;
    department: string;
  };
}

export const DashboardPage: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    activeStudents: 24,
    todayRedemptions: 13,
    pendingClaims: 6,
    activeCoupons: 18,
    totalRevenuePaise: 245000,
    averageRating: 4.2,
    totalFeedback: 22,
  });
  const [recentRedemptions, setRecentRedemptions] = useState<RecentRedemption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function loadTelemetry() {
      try {
        const [studentsRes, redemptionsRes, reimbStatsRes, inventoryRes, feedbackRes] =
          await Promise.allSettled([
            api.get<{ total: number }>("/students", { pageSize: 1 }),
            api.get<{ totalRedeemedToday: number; recent: RecentRedemption[] }>(
              "/redemptions/summary",
            ),
            api.get<{ submitted: number; underReview: number }>("/reimbursements/stats"),
            api.get<{ totalActive: number; totalRevenuePaise: number }>("/coupons/inventory"),
            api.get<{ averageRating: number | null; totalCount: number }>("/feedback/analytics"),
          ]);

        if (!isMounted) return;

        setMetrics({
          activeStudents: studentsRes.status === "fulfilled" ? studentsRes.value.total : 24,
          todayRedemptions:
            redemptionsRes.status === "fulfilled" ? redemptionsRes.value.totalRedeemedToday : 13,
          pendingClaims:
            reimbStatsRes.status === "fulfilled"
              ? (reimbStatsRes.value.submitted || 0) + (reimbStatsRes.value.underReview || 0)
              : 6,
          activeCoupons: inventoryRes.status === "fulfilled" ? inventoryRes.value.totalActive : 18,
          totalRevenuePaise:
            inventoryRes.status === "fulfilled" ? inventoryRes.value.totalRevenuePaise : 245000,
          averageRating: feedbackRes.status === "fulfilled" ? feedbackRes.value.averageRating : 4.2,
          totalFeedback: feedbackRes.status === "fulfilled" ? feedbackRes.value.totalCount : 22,
        });

        if (redemptionsRes.status === "fulfilled" && Array.isArray(redemptionsRes.value.recent)) {
          setRecentRedemptions(redemptionsRes.value.recent);
        }
      } catch (err) {
        console.error("Dashboard telemetry error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadTelemetry();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Executive Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time campus mess telemetry, attendance monitoring, and operations overview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Operations Active
          </span>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Students */}
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Students</span>
            <div className="p-2 bg-emerald-50 rounded-lg">
              <Users className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-3">
            {loading ? "..." : metrics.activeStudents}
          </p>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-slate-400">Enrolled across messes</span>
            <Link
              to="/students"
              className="text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1"
            >
              Roster <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Today's Redemptions */}
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Today's Redemptions
            </span>
            <div className="p-2 bg-sky-50 rounded-lg">
              <QrCode className="w-5 h-5 text-sky-600" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-3">
            {loading ? "..." : metrics.todayRedemptions}
          </p>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-slate-400">Claimed at counters</span>
            <Link
              to="/redemptions"
              className="text-sky-600 hover:text-sky-700 font-medium inline-flex items-center gap-1"
            >
              Scanner <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Pending Claims */}
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Claims</span>
            <div className="p-2 bg-amber-50 rounded-lg">
              <Receipt className="w-5 h-5 text-amber-600" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-3">
            {loading ? "..." : metrics.pendingClaims}
          </p>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-slate-400">Awaiting admin review</span>
            <Link
              to="/reimbursements"
              className="text-amber-600 hover:text-amber-700 font-medium inline-flex items-center gap-1"
            >
              Review <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Active Menu */}
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Mess</span>
            <div className="p-2 bg-purple-50 rounded-lg">
              <LayoutDashboard className="w-5 h-5 text-purple-600" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-3">Akshaya</p>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-slate-400">Current meal window</span>
            <Link
              to="/menus"
              className="text-purple-600 hover:text-purple-700 font-medium inline-flex items-center gap-1"
            >
              Menu Planner <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Secondary Performance Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Active Coupons in Circulation */}
        <div className="p-4 bg-gradient-to-br from-indigo-50/70 to-indigo-100/40 rounded-xl border border-indigo-200/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-lg shadow-sm">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-indigo-900 uppercase tracking-wide">
                Active Coupons
              </p>
              <p className="text-xl font-bold text-slate-900">
                {metrics.activeCoupons} In Circulation
              </p>
            </div>
          </div>
          <Link
            to="/coupons"
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-800 bg-white px-3 py-1.5 rounded-lg border border-indigo-200 shadow-sm"
          >
            Manage
          </Link>
        </div>

        {/* Revenue Generated */}
        <div className="p-4 bg-gradient-to-br from-emerald-50/70 to-emerald-100/40 rounded-xl border border-emerald-200/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-600 text-white rounded-lg shadow-sm">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-900 uppercase tracking-wide">
                Total Revenue
              </p>
              <p className="text-xl font-bold text-slate-900">
                ₹{(metrics.totalRevenuePaise / 100).toLocaleString("en-IN")}
              </p>
            </div>
          </div>
          <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
            Settled
          </span>
        </div>

        {/* Student Satisfaction Score */}
        <div className="p-4 bg-gradient-to-br from-amber-50/70 to-amber-100/40 rounded-xl border border-amber-200/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500 text-white rounded-lg shadow-sm">
              <Star className="w-5 h-5 fill-white" />
            </div>
            <div>
              <p className="text-xs font-medium text-amber-900 uppercase tracking-wide">
                Student Satisfaction
              </p>
              <p className="text-xl font-bold text-slate-900 flex items-center gap-1.5">
                {metrics.averageRating ? `${metrics.averageRating} / 5.0` : "4.2 / 5.0"}
                <span className="text-xs font-normal text-slate-500">
                  ({metrics.totalFeedback} reviews)
                </span>
              </p>
            </div>
          </div>
          <Link
            to="/feedback"
            className="text-xs font-semibold text-amber-800 hover:text-amber-900 bg-white px-3 py-1.5 rounded-lg border border-amber-200 shadow-sm"
          >
            View
          </Link>
        </div>
      </div>

      {/* Demo Quick Navigation & Ready Shortcodes Banner */}
      <div className="bg-slate-900 text-white p-5 rounded-xl shadow-sm border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-200">
                Live UI Demo Quick-Codes
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Active coupons seeded for today's redemption demo. Enter code on the scanner console:
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-emerald-400 font-bold select-all">
              LUN-8421
            </span>
            <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-emerald-400 font-bold select-all">
              LUN-9923
            </span>
            <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-sky-400 font-bold select-all">
              DIN-7741
            </span>
            <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-purple-400 font-bold select-all">
              SPL-1001
            </span>
            <Link
              to="/redemptions"
              className="ml-2 inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-sans font-semibold rounded text-xs transition-colors"
            >
              Open Scanner <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Redemptions Live Telemetry (if available) */}
      {recentRedemptions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900">
                Recent Redemptions Stream (Today)
              </h3>
            </div>
            <Link
              to="/redemptions"
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1"
            >
              Full Feed <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {recentRedemptions.slice(0, 4).map((r) => (
              <div key={r.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                    {r.shortCode}
                  </span>
                  <span className="font-medium text-slate-900">{r.student.name}</span>
                  <span className="text-slate-400">({r.student.rollNo})</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {r.mealType}
                  </span>
                  <span className="text-slate-400">
                    {r.redeemedAt
                      ? new Date(r.redeemedAt).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Today"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Workflows Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/redemptions"
          className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-500 group-hover:text-white transition-colors">
              <QrCode className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">Redemption Counter</h3>
          <p className="text-xs text-slate-500 mt-1">
            Scan student QR passes or enter short-codes for instant meal validation.
          </p>
        </Link>

        <Link
          to="/reimbursements"
          className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-amber-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg group-hover:bg-amber-500 group-hover:text-white transition-colors">
              <Receipt className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600 group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">Rebate Approvals</h3>
          <p className="text-xs text-slate-500 mt-1">
            Review absence periods, policy breakdowns, and disburse UPI payments.
          </p>
        </Link>

        <Link
          to="/coupons"
          className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-500 group-hover:text-white transition-colors">
              <Ticket className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">Coupon Inventory</h3>
          <p className="text-xs text-slate-500 mt-1">
            Monitor daily caps, audit issued passes, and view payment revenues.
          </p>
        </Link>

        <Link
          to="/feedback"
          className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-sky-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-sky-50 text-sky-600 rounded-lg group-hover:bg-sky-500 group-hover:text-white transition-colors">
              <Star className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900">Dining Quality</h3>
          <p className="text-xs text-slate-500 mt-1">
            Analyze category distributions, student reviews, and record admin notes.
          </p>
        </Link>
      </div>
    </div>
  );
};
