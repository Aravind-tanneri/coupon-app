import React, { useState, useEffect, useCallback } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/common/Toast";
import { DataTable, Column } from "../components/common/DataTable";
import { StatusBadge } from "../components/common/StatusBadge";
import { ISTDateDisplay } from "../components/common/ISTDateDisplay";
import { Modal } from "../components/common/Modal";
import { Star, MessageSquare, CheckCircle, Eye, Filter, CheckCheck } from "lucide-react";

interface FeedbackItem {
  id: string;
  category: "FOOD_QUALITY" | "MENU" | "SERVICE" | "OTHER";
  message: string;
  rating: number | null;
  mealType: string | null;
  isAnonymous: boolean;
  status: "NEW" | "REVIEWED" | "RESOLVED";
  adminNote: string | null;
  imageDocId: string | null;
  createdAt: string;
  mess: { id: string; code: string; name: string };
  student: {
    id: string;
    rollNo: string;
    name: string;
    department: string;
  };
}

interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface FeedbackAnalytics {
  totalCount: number;
  ratingCount: number;
  averageRating: number | null;
  ratingDistribution: Record<number, number>;
  categoryDistribution: Record<string, number>;
  mealDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  daysAnalyzed: number;
}

export const FeedbackPage: React.FC = () => {
  const { user, can } = useAuth();
  const toast = useToast();

  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [ratingFilter, setRatingFilter] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // Detail Modal State
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [adminNote, setAdminNote] = useState<string>("");
  const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);

  const fetchAnalytics = useCallback(async () => {
    try {
      const data = await api.get<FeedbackAnalytics>("/feedback/analytics", {
        messId: user?.messId || undefined,
        days: 30,
      });
      setAnalytics(data);
    } catch {
      // Non-fatal if analytics load fails
    }
  }, [user?.messId]);

  const fetchFeedbacks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<FeedbackListResponse>("/feedback", {
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
        rating: ratingFilter || undefined,
        messId: user?.messId || undefined,
        page,
        pageSize: 15,
      });
      setFeedbacks(data.items);
      setTotalPages(data.totalPages);
      setTotalItems(data.total);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Failed to load feedbacks", err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, ratingFilter, user?.messId, page, toast]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    fetchFeedbacks();
  }, [fetchFeedbacks]);

  const handleStatusChange = async (newStatus: "REVIEWED" | "RESOLVED") => {
    if (!selectedFeedback) return;
    setUpdatingStatus(true);
    try {
      await api.patch(`/feedback/${selectedFeedback.id}/status`, {
        status: newStatus,
        adminNote: adminNote.trim() || undefined,
      });

      toast.success("Feedback Updated", `Marked as ${newStatus.toLowerCase()} successfully.`);
      setSelectedFeedback(null);
      fetchFeedbacks();
      fetchAnalytics();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Update Failed", err.message);
      }
    } finally {
      setUpdatingStatus(false);
    }
  };

  const renderStars = (rating: number | null) => {
    if (rating === null) return <span className="text-slate-400 text-xs">Unrated</span>;
    return (
      <div className="flex items-center gap-0.5 text-amber-500">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={`w-3.5 h-3.5 ${
              i < rating ? "fill-amber-400 text-amber-400" : "text-slate-200"
            }`}
          />
        ))}
        <span className="text-xs font-semibold ml-1 text-slate-700">{rating}</span>
      </div>
    );
  };

  const columns: Column<FeedbackItem>[] = [
    {
      key: "rating",
      header: "Rating",
      render: (f) => renderStars(f.rating),
    },
    {
      key: "category",
      header: "Category",
      render: (f) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
          {f.category.replace("_", " ")}
        </span>
      ),
    },
    {
      key: "mealType",
      header: "Meal",
      render: (f) => (
        <span className="text-xs text-slate-600 font-medium">
          {f.mealType ? f.mealType.replace("_", " ") : "General"}
        </span>
      ),
    },
    {
      key: "message",
      header: "Feedback",
      render: (f) => (
        <div className="max-w-md">
          <p className="text-xs text-slate-800 line-clamp-2">{f.message}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            By <strong className="font-medium text-slate-600">{f.student.name}</strong>
            {!f.isAnonymous && ` (${f.student.rollNo})`}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (f) => <StatusBadge status={f.status} />,
    },
    {
      key: "createdAt",
      header: "Date",
      render: (f) => (
        <ISTDateDisplay date={f.createdAt} format="short" className="text-xs text-slate-500" />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (f) => (
        <button
          onClick={() => {
            setSelectedFeedback(f);
            setAdminNote(f.adminNote || "");
          }}
          className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-slate-100 transition-colors focus:outline-none"
          title="Review feedback"
        >
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Student Feedback & Quality Control
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Monitor student meal satisfaction, categorize issues, and track resolutions.
        </p>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Average Rating Card */}
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Average Rating</span>
              <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-slate-900">
                {analytics.averageRating ? analytics.averageRating.toFixed(1) : "—"}
              </span>
              <span className="text-xs text-slate-400">/ 5.0</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Based on <strong>{analytics.ratingCount}</strong> rated reviews (30d)
            </p>
          </div>

          {/* Total Submissions Card */}
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">
                Total Submissions
              </span>
              <MessageSquare className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-2">{analytics.totalCount}</p>
            <p className="text-xs text-slate-500 mt-1">
              {analytics.statusDistribution["NEW"] || 0} pending review
            </p>
          </div>

          {/* Quality Breakdown Card */}
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-2">
              Category Distribution
            </span>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Food Quality</span>
                <strong className="text-slate-800">
                  {analytics.categoryDistribution["FOOD_QUALITY"] || 0}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Menu & Variety</span>
                <strong className="text-slate-800">
                  {analytics.categoryDistribution["MENU"] || 0}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Service / Hygiene</span>
                <strong className="text-slate-800">
                  {analytics.categoryDistribution["SERVICE"] || 0}
                </strong>
              </div>
            </div>
          </div>

          {/* Resolution Card */}
          <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-2">
              Resolution Progress
            </span>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-emerald-700">Resolved</span>
                <strong className="text-emerald-800">
                  {analytics.statusDistribution["RESOLVED"] || 0}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-sky-700">Reviewed</span>
                <strong className="text-sky-800">
                  {analytics.statusDistribution["REVIEWED"] || 0}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-700">New / Unreviewed</span>
                <strong className="text-amber-800">
                  {analytics.statusDistribution["NEW"] || 0}
                </strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm text-xs">
        <div className="flex items-center gap-1.5 text-slate-500 font-semibold uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5" />
          <span>Filters:</span>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Statuses</option>
          <option value="NEW">New</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="RESOLVED">Resolved</option>
        </select>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Categories</option>
          <option value="FOOD_QUALITY">Food Quality</option>
          <option value="MENU">Menu</option>
          <option value="SERVICE">Service</option>
          <option value="OTHER">Other</option>
        </select>

        {/* Rating filter */}
        <select
          value={ratingFilter}
          onChange={(e) => {
            setRatingFilter(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Ratings</option>
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </select>
      </div>

      {/* Feedback Table */}
      <DataTable
        columns={columns}
        data={feedbacks}
        loading={loading}
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={(p) => setPage(p)}
        emptyMessage="No feedback found matching the selected filters."
      />

      {/* Review Feedback Detail Modal */}
      {selectedFeedback && (
        <Modal
          isOpen={Boolean(selectedFeedback)}
          onClose={() => setSelectedFeedback(null)}
          title="Review Feedback"
          description={`Submitted on ${selectedFeedback.createdAt.split("T")[0]}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            {/* Header with Student and Rating */}
            <div className="flex items-start justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {selectedFeedback.student.name}
                </p>
                <p className="text-xs text-slate-500">
                  {selectedFeedback.isAnonymous
                    ? "Identity protected (Anonymous student submission)"
                    : `${selectedFeedback.student.rollNo} • ${selectedFeedback.student.department}`}
                </p>
              </div>
              <div className="text-right">
                {renderStars(selectedFeedback.rating)}
                <div className="mt-1">
                  <StatusBadge status={selectedFeedback.status} />
                </div>
              </div>
            </div>

            {/* Message Body */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Student Message
              </label>
              <div className="p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                {selectedFeedback.message}
              </div>
            </div>

            {/* Admin Response Note */}
            {can("feedback:manage") && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Admin Resolution Note (Internal / Action taken)
                </label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="e.g. Discussed with head chef. Kitchen temperature controls recalibrated."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
              >
                Close
              </button>

              {can("feedback:manage") && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleStatusChange("REVIEWED")}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4 text-sky-600" />
                    <span>Mark Reviewed</span>
                  </button>
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleStatusChange("RESOLVED")}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCheck className="w-4 h-4" />
                    <span>Mark Resolved</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
