import React, { useState, useEffect, useCallback } from "react";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../components/common/Toast";
import { DataTable, Column } from "../components/common/DataTable";
import { StatusBadge } from "../components/common/StatusBadge";
import { ISTDateDisplay } from "../components/common/ISTDateDisplay";
import { Modal } from "../components/common/Modal";
import {
  Gift,
  Search,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Send,
  Eye,
  ShieldAlert,
} from "lucide-react";

interface StudentOption {
  id: string;
  rollNo: string;
  name: string;
  email: string;
  department: string;
  messId: string;
}

interface GiftBatchItem {
  id: string;
  messId: string;
  mess: { id: string; code: string; name: string };
  createdById: string;
  mealDate: string;
  message: string | null;
  idempotencyKey: string;
  status: string;
  createdAt: string;
  counts: {
    total: number;
    active: number;
    redeemed: number;
    revoked: number;
  };
}

interface BatchDetailStudentItem {
  id: string;
  studentId: string;
  student: {
    id: string;
    rollNo: string;
    name: string;
    email: string;
    department: string;
  } | null;
  couponId: string | null;
  coupon: {
    id: string;
    shortCode: string;
    status: string;
    validDate: string;
    mealType: string;
    redeemedAt: string | null;
    revokedAt: string | null;
  } | null;
  emailStatus: string;
  whatsappStatus: string;
  createdAt: string;
}

interface BatchDetails {
  id: string;
  messId: string;
  mess: { id: string; code: string; name: string };
  createdById: string;
  mealDate: string;
  message: string | null;
  status: string;
  createdAt: string;
  counts: {
    total: number;
    active: number;
    redeemed: number;
    revoked: number;
  };
  items: BatchDetailStudentItem[];
}

interface IssueResultSummary {
  batchId: string;
  mealDate: string;
  totalRequested: number;
  issued: number;
  skippedDuplicate: number;
  failed: number;
}

export const GiftsPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  // Batches state
  const [batches, setBatches] = useState<GiftBatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Stats
  const [stats, setStats] = useState({
    totalBatches: 0,
    totalIssued: 0,
    totalActive: 0,
    totalRedeemed: 0,
    totalRevoked: 0,
  });

  // Issue Batch Modal
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueLoading, setIssueLoading] = useState(false);
  const [mealDate, setMealDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0]!;
  });
  const [message, setMessage] = useState("");
  const [messId] = useState(user?.messId || "akshaya");

  // Student selection in issue modal
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  // Result summary modal
  const [issueResult, setIssueResult] = useState<IssueResultSummary | null>(null);

  // Batch Detail Modal
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchDetails, setBatchDetails] = useState<BatchDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");

  // Revocation Modal
  const [revokeCouponId, setRevokeCouponId] = useState<string | null>(null);
  const [revokeStudentName, setRevokeStudentName] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeLoading, setRevokeLoading] = useState(false);

  // Resend Notifications Modal
  const [resendBatchId, setResendBatchId] = useState<string | null>(null);
  const [resendChannel, setResendChannel] = useState<"ALL" | "EMAIL" | "WHATSAPP">("ALL");
  const [resendLoading, setResendLoading] = useState(false);

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{
        batches: GiftBatchItem[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>("/gifts", {
        page,
        pageSize: 10,
        messId: user?.messId || undefined,
      });

      setBatches(res.batches);
      setTotalPages(res.totalPages);
      setTotalItems(res.total);

      // Compute aggregate stats
      let totalIssued = 0;
      let totalActive = 0;
      let totalRedeemed = 0;
      let totalRevoked = 0;
      for (const b of res.batches) {
        totalIssued += b.counts.total;
        totalActive += b.counts.active;
        totalRedeemed += b.counts.redeemed;
        totalRevoked += b.counts.revoked;
      }
      setStats({
        totalBatches: res.total,
        totalIssued,
        totalActive,
        totalRedeemed,
        totalRevoked,
      });
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Failed to load gift batches";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [page, user?.messId, toast]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Load students for selection modal
  const loadStudents = useCallback(async () => {
    try {
      setStudentsLoading(true);
      const res = await api.get<{ items: StudentOption[] }>("/students", {
        pageSize: 200,
        messId: user?.messId || undefined,
      });
      setStudents(res.items || []);
    } catch {
      toast.error("Failed to fetch students roster");
    } finally {
      setStudentsLoading(false);
    }
  }, [user?.messId, toast]);

  const handleOpenIssueModal = () => {
    setIsIssueModalOpen(true);
    setSelectedStudentIds(new Set());
    setMessage("");
    loadStudents();
  };

  const handleToggleStudent = (id: string) => {
    const next = new Set(selectedStudentIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 300) {
        toast.info("Maximum 300 students permitted per gift batch (§19)");
        return;
      }
      next.add(id);
    }
    setSelectedStudentIds(next);
  };

  const handleSelectAllVisible = () => {
    const next = new Set(selectedStudentIds);
    for (const s of filteredStudents) {
      if (next.size >= 300) break;
      next.add(s.id);
    }
    setSelectedStudentIds(next);
  };

  const handleClearSelection = () => {
    setSelectedStudentIds(new Set());
  };

  const filteredStudents = students.filter((s) => {
    if (!studentSearch.trim()) return true;
    const query = studentSearch.toLowerCase();
    return (
      s.name.toLowerCase().includes(query) ||
      s.rollNo.toLowerCase().includes(query) ||
      s.department.toLowerCase().includes(query)
    );
  });

  const handleIssueBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStudentIds.size === 0) {
      toast.error("Please select at least one student recipient");
      return;
    }

    try {
      setIssueLoading(true);
      const idempotencyKey = `gift_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const res = await api.post<IssueResultSummary>(
        "/gifts",
        {
          messId,
          mealDate,
          message: message.trim() || undefined,
          studentIds: Array.from(selectedStudentIds),
          idempotencyKey,
        },
        {
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        } as never,
      );

      setIsIssueModalOpen(false);
      setIssueResult(res);
      fetchBatches();
      toast.success(`Gift batch created! ${res.issued} coupons issued.`);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Failed to issue gift batch";
      toast.error(msg);
    } finally {
      setIssueLoading(false);
    }
  };

  // Open details
  const handleOpenDetails = async (batchId: string) => {
    setSelectedBatchId(batchId);
    setDetailSearch("");
    try {
      setDetailLoading(true);
      const res = await api.get<BatchDetails>(`/gifts/${batchId}`);
      setBatchDetails(res);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Failed to fetch batch details";
      toast.error(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  // Revoke action
  const handlePromptRevoke = (couponId: string, studentName: string) => {
    setRevokeCouponId(couponId);
    setRevokeStudentName(studentName);
    setRevokeReason("");
  };

  const handleConfirmRevoke = async () => {
    if (!revokeCouponId) return;
    try {
      setRevokeLoading(true);
      await api.post(`/gifts/coupons/${revokeCouponId}/revoke`, {
        reason: revokeReason.trim() || undefined,
      });

      toast.success("Coupon revoked successfully");
      setRevokeCouponId(null);

      // Refresh current detail modal if open
      if (selectedBatchId) {
        handleOpenDetails(selectedBatchId);
      }
      fetchBatches();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "CANNOT_REVOKE_REDEEMED") {
        toast.error("Cannot revoke: This coupon was already redeemed at the counter!");
      } else {
        const msg = err instanceof ApiClientError ? err.message : "Failed to revoke coupon";
        toast.error(msg);
      }
    } finally {
      setRevokeLoading(false);
    }
  };

  // Resend notifications
  const handleOpenResend = (batchId: string) => {
    setResendBatchId(batchId);
    setResendChannel("ALL");
  };

  const handleConfirmResend = async () => {
    if (!resendBatchId) return;
    try {
      setResendLoading(true);
      const res = await api.post<{ enqueuedCount: number }>(`/gifts/${resendBatchId}/resend`, {
        channel: resendChannel,
      });

      toast.success(`Resent ${res.enqueuedCount} notifications`);
      setResendBatchId(null);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Failed to resend notifications";
      toast.error(msg);
    } finally {
      setResendLoading(false);
    }
  };

  // Table columns for Batches
  const columns: Column<GiftBatchItem>[] = [
    {
      key: "mealDate",
      header: "Special Dinner Date",
      render: (item) => (
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-600" />
          <span className="font-semibold text-slate-800">{item.mealDate}</span>
        </div>
      ),
    },
    {
      key: "mess",
      header: "Dining Hall",
      render: (item) => <span className="font-medium text-slate-700">{item.mess.name}</span>,
    },
    {
      key: "message",
      header: "Occasion / Note",
      render: (item) => (
        <span className="text-slate-600 text-sm italic">
          {item.message || "Complimentary Gift"}
        </span>
      ),
    },
    {
      key: "counts.total",
      header: "Total Coupons",
      render: (item) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          {item.counts.total} students
        </span>
      ),
    },
    {
      key: "redemptionStatus",
      header: "Redemption Breakdown",
      render: (item) => (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            {item.counts.active} Active
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            {item.counts.redeemed} Redeemed
          </span>
          {item.counts.revoked > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
              {item.counts.revoked} Revoked
            </span>
          )}
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Issued At",
      render: (item) => <ISTDateDisplay date={item.createdAt} format="datetime" />,
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (item) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => handleOpenDetails(item.id)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            View Roster
          </button>
          <button
            onClick={() => handleOpenResend(item.id)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors"
            title="Resend Delivery Alerts"
          >
            <Send className="w-3.5 h-3.5 text-slate-500" />
            Resend
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Gift Coupons</h1>
          <p className="text-sm text-slate-500 mt-1">
            Issue complimentary Special Dinner coupons to students for festivals, guests, and campus
            events (§19).
          </p>
        </div>
        <button
          onClick={handleOpenIssueModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-sm text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Issue Gift Batch
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Batches
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.totalBatches}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Issued
          </div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{stats.totalIssued}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active / Ready
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.totalActive}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Redeemed
          </div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{stats.totalRedeemed}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Revoked
          </div>
          <div className="text-2xl font-bold text-slate-500 mt-1">{stats.totalRevoked}</div>
        </div>
      </div>

      {/* Main Table */}
      <DataTable
        columns={columns}
        data={batches}
        loading={loading}
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={setPage}
        emptyMessage="No gift batches have been issued yet. Click 'Issue Gift Batch' to get started."
        actions={
          <button
            onClick={fetchBatches}
            className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        }
      />

      {/* ISSUE BATCH MODAL */}
      <Modal
        isOpen={isIssueModalOpen}
        onClose={() => setIsIssueModalOpen(false)}
        title="Issue Complimentary Gift Coupons"
        description="Select eligible students and set the special dinner meal date."
        maxWidth="3xl"
      >
        <form onSubmit={handleIssueBatch} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Special Dinner Date *
              </label>
              <input
                type="date"
                required
                min={new Date().toISOString().split("T")[0]}
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-slate-400 mt-1">Must be today or in the future (§19).</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Occasion / Notice
              </label>
              <input
                type="text"
                placeholder="e.g. Diwali Feast 2026 / Annual Fest"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={255}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Student Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Select Students ({selectedStudentIds.size} / 300)
              </label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  className="text-emerald-600 font-medium hover:underline"
                >
                  Select Visible
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="text-slate-500 font-medium hover:underline"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search students by name, roll number, or branch..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Students Checkbox Container */}
            <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-slate-100 bg-slate-50/50">
              {studentsLoading ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  Loading student roster...
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  No students matched search.
                </div>
              ) : (
                filteredStudents.map((s) => {
                  const isChecked = selectedStudentIds.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-100/70 transition-colors ${
                        isChecked ? "bg-emerald-50/60" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleStudent(s.id)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-slate-800">{s.name}</span>
                        <span className="text-xs text-slate-500 ml-2">({s.rollNo})</span>
                        <span className="text-xs text-slate-400 ml-2">· {s.department}</span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Batch Preview Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1 text-slate-600">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Gift className="w-3.5 h-3.5 text-emerald-600" />
              Batch Summary Preview
            </div>
            <div>
              Target: <span className="font-medium text-slate-900">SPECIAL_DINNER</span> on{" "}
              <span className="font-medium text-slate-900">{mealDate}</span>
            </div>
            <div>
              Recipients:{" "}
              <span className="font-medium text-slate-900">{selectedStudentIds.size}</span> students
              selected
            </div>
            <div className="text-slate-400 italic">
              Note: System automatically skips students holding an active gift on this date (§19).
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsIssueModalOpen(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issueLoading || selectedStudentIds.size === 0}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {issueLoading ? "Issuing Coupons..." : `Confirm & Issue (${selectedStudentIds.size})`}
            </button>
          </div>
        </form>
      </Modal>

      {/* RESULT SUMMARY MODAL */}
      <Modal
        isOpen={issueResult !== null}
        onClose={() => setIssueResult(null)}
        title="Gift Batch Issuance Report"
        maxWidth="md"
      >
        {issueResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
              <div>
                <div className="font-semibold text-emerald-900">
                  {issueResult.issued} Coupons Issued Successfully
                </div>
                <div className="text-xs text-emerald-700">
                  Meal date: {issueResult.mealDate} (SPECIAL_DINNER)
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm border border-slate-100 rounded-xl p-3 bg-slate-50/50">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Requested:</span>
                <span className="font-semibold text-slate-800">{issueResult.totalRequested}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Newly Issued:</span>
                <span className="font-semibold text-emerald-600">{issueResult.issued}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Skipped (Duplicate / Holding Gift):</span>
                <span className="font-semibold text-amber-600">{issueResult.skippedDuplicate}</span>
              </div>
              {issueResult.failed > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Failed:</span>
                  <span className="font-semibold text-rose-600">{issueResult.failed}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setIssueResult(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium"
              >
                Close Report
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* BATCH DETAILS & ROSTER MODAL */}
      <Modal
        isOpen={selectedBatchId !== null}
        onClose={() => setSelectedBatchId(null)}
        title={`Batch Roster: ${batchDetails?.message || "Complimentary Gift"}`}
        description={`Meal Date: ${batchDetails?.mealDate} · Dining Hall: ${batchDetails?.mess.name}`}
        maxWidth="4xl"
      >
        <div className="space-y-4">
          {detailLoading ? (
            <div className="p-8 text-center text-slate-500">
              Loading student roster and coupon statuses...
            </div>
          ) : batchDetails ? (
            <>
              {/* Batch Counters */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <span className="font-semibold text-slate-700">Status Summary:</span>
                <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-semibold text-slate-800">
                  Total: {batchDetails.counts.total}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 font-semibold text-emerald-700">
                  Active: {batchDetails.counts.active}
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 font-semibold text-blue-700">
                  Redeemed: {batchDetails.counts.redeemed}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-semibold text-slate-600">
                  Revoked: {batchDetails.counts.revoked}
                </span>
              </div>

              {/* Search in details */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter roster by student name, roll number, or short code..."
                  value={detailSearch}
                  onChange={(e) => setDetailSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2.5">Student</th>
                      <th className="px-4 py-2.5">Roll No</th>
                      <th className="px-4 py-2.5">Coupon Code</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Redemption Time</th>
                      <th className="px-4 py-2.5">Alerts Delivery</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchDetails.items
                      .filter((i) => {
                        if (!detailSearch.trim()) return true;
                        const q = detailSearch.toLowerCase();
                        return (
                          i.student?.name.toLowerCase().includes(q) ||
                          i.student?.rollNo.toLowerCase().includes(q) ||
                          i.coupon?.shortCode.toLowerCase().includes(q)
                        );
                      })
                      .map((item) => {
                        const isRedeemed = item.coupon?.status === "REDEEMED";
                        const isRevoked = item.coupon?.status === "REVOKED";
                        const isActive = item.coupon?.status === "ACTIVE";

                        return (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              {item.student?.name || "Unknown Student"}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 font-mono">
                              {item.student?.rollNo}
                            </td>
                            <td className="px-4 py-2.5">
                              {item.coupon ? (
                                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                                  {item.coupon.shortCode}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status={item.coupon?.status || "PENDING"} />
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">
                              {item.coupon?.redeemedAt ? (
                                <ISTDateDisplay date={item.coupon.redeemedAt} format="datetime" />
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-col gap-1 text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-400 font-medium">Email:</span>
                                  <StatusBadge status={item.emailStatus} />
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-400 font-medium">WA:</span>
                                  <StatusBadge status={item.whatsappStatus} />
                                  {item.whatsappStatus === "FAILED" && (
                                    <span
                                      className="text-rose-600 font-medium text-[10px]"
                                      title="WhatsApp delivery failed or phone not linked"
                                    >
                                      ⚠️ Failed
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {isActive && item.coupon ? (
                                <button
                                  onClick={() =>
                                    handlePromptRevoke(
                                      item.coupon!.id,
                                      item.student?.name || "Student",
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-medium transition-colors"
                                >
                                  <ShieldAlert className="w-3 h-3" />
                                  Revoke
                                </button>
                              ) : isRedeemed ? (
                                <span className="text-slate-400 text-xs italic">Redeemed</span>
                              ) : isRevoked ? (
                                <span className="text-slate-400 text-xs italic">Revoked</span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-slate-500">Batch not found.</div>
          )}
        </div>
      </Modal>

      {/* REVOKE COUPON CONFIRMATION MODAL */}
      <Modal
        isOpen={revokeCouponId !== null}
        onClose={() => setRevokeCouponId(null)}
        title="Revoke Gift Coupon"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Atomic Revocation Guard (§20.4)</div>
              <div>
                Are you sure you want to revoke the active gift coupon for{" "}
                <span className="font-bold">{revokeStudentName}</span>? If the student redeems it at
                the counter simultaneously, revocation will be refused.
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Revocation Reason (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Student absent / issued in error"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setRevokeCouponId(null)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmRevoke}
              disabled={revokeLoading}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {revokeLoading ? "Revoking..." : "Confirm Revoke"}
            </button>
          </div>
        </div>
      </Modal>

      {/* RESEND NOTIFICATIONS MODAL */}
      <Modal
        isOpen={resendBatchId !== null}
        onClose={() => setResendBatchId(null)}
        title="Resend Gift Notifications"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Resends notification alerts (Email / WhatsApp) for students with pending or failed
            deliveries. This never re-issues coupons (§19).
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Channel</label>
            <select
              value={resendChannel}
              onChange={(e) => setResendChannel(e.target.value as "ALL" | "EMAIL" | "WHATSAPP")}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ALL">All Channels (Email + WhatsApp)</option>
              <option value="EMAIL">Email Only</option>
              <option value="WHATSAPP">WhatsApp Only</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setResendBatchId(null)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmResend}
              disabled={resendLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {resendLoading ? "Enqueuing..." : "Resend Alerts"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
