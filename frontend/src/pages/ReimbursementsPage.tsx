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
  Receipt,
  Search,
  Clock,
  ArrowRight,
  ShieldCheck,
  FileText,
  DollarSign,
  AlertTriangle,
  Plus,
  Lock,
} from "lucide-react";

interface PolicySegment {
  policyId: string;
  dailyRatePaise: number;
  days: number;
  fromDate: string;
  toDate: string;
  amountPaise: number;
}

interface CalculationBreakdown {
  startDate: string;
  endDate: string;
  departureDateExcluded: string;
  returnDateExcluded: string;
  countedDays: number;
  rateAtClaimPaise: number;
  claimablePaise: number;
  segments: PolicySegment[];
}

interface StudentSnapshot {
  name: string;
  rollNo: string;
  department: string;
  messCode: string;
}

interface ReimbursementClaim {
  id: string;
  publicRef: string;
  messId: string;
  studentId: string;
  startDate: string;
  endDate: string;
  countedDays: number;
  rateAtClaimPaise: number;
  claimedAmountPaise: number;
  approvedAmountPaise: number | null;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "APPROVED"
    | "PAYMENT_PENDING"
    | "PAID"
    | "REJECTED"
    | "INFO_REQUESTED"
    | "CANCELLED";
  version: number;
  reason: string | null;
  rejectionReason: string | null;
  maskedPayout?: string | null;
  studentSnapshot: StudentSnapshot;
  calculationBreakdown: CalculationBreakdown;
  createdAt: string;
  student: {
    id: string;
    rollNo: string;
    name: string;
    department: string;
  };
  mess: {
    id: string;
    code: string;
    name: string;
  };
  documents?: Array<{
    id: string;
    originalName: string;
    sizeBytes: number;
    mime: string;
    createdAt: string;
  }>;
  statusHistory?: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    actorType: string;
    remarks: string | null;
    approvedAmountPaise: number | null;
    at: string;
  }>;
  payments?: Array<{
    id: string;
    amountPaise: number;
    method: string;
    reference: string;
    paidAt: string;
  }>;
}

interface PolicyItem {
  id: string;
  messId: string;
  dailyRatePaise: number;
  minAbsenceDays: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  claimDeadlineDays: number;
  maxAbsenceDays: number | null;
  documentRequired: boolean;
  createdAt: string;
}

interface ClaimStats {
  submitted: number;
  underReview: number;
  approved: number;
  paid: number;
  rejected: number;
  infoRequested: number;
  totalActive: number;
}

interface PaginatedClaims {
  items: ReimbursementClaim[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const ReimbursementsPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"pipeline" | "policies">("pipeline");

  // Stats
  const [stats, setStats] = useState<ClaimStats | null>(null);

  // Claims Table State
  const [claimsData, setClaimsData] = useState<PaginatedClaims>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
  const [loadingClaims, setLoadingClaims] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Detail Modal State
  const [selectedClaim, setSelectedClaim] = useState<ReimbursementClaim | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [staleError, setStaleError] = useState<boolean>(false);

  // Sub-modal action states
  const [isApproveOpen, setIsApproveOpen] = useState<boolean>(false);
  const [approveAmountRupees, setApproveAmountRupees] = useState<string>("");
  const [approveRemarks, setApproveRemarks] = useState<string>("");

  const [isRejectOpen, setIsRejectOpen] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>("");

  const [isRequestInfoOpen, setIsRequestInfoOpen] = useState<boolean>(false);
  const [infoMessage, setInfoMessage] = useState<string>("");

  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState<boolean>(false);
  const [paymentForm, setPaymentForm] = useState({
    amountRupees: "",
    method: "UPI",
    reference: "",
    note: "",
  });

  // Policies State
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [isCreatePolicyOpen, setIsCreatePolicyOpen] = useState<boolean>(false);
  const [policyForm, setPolicyForm] = useState({
    dailyRateRupees: "135",
    minAbsenceDays: "4",
    effectiveFrom: new Date(Date.now() + 86400000).toISOString().split("T")[0]!,
    claimDeadlineDays: "30",
    maxAbsenceDays: "",
    documentRequired: false,
  });
  const [savingPolicy, setSavingPolicy] = useState<boolean>(false);

  // Fetch Stats
  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<ClaimStats>("/reimbursements/stats", {
        messId: user?.messId || undefined,
      });
      setStats(data);
    } catch {
      // Non-fatal
    }
  }, [user?.messId]);

  // Fetch Claims
  const fetchClaims = useCallback(
    async (page = 1) => {
      setLoadingClaims(true);
      try {
        const data = await api.get<PaginatedClaims>("/reimbursements", {
          page,
          pageSize: 20,
          messId: user?.messId || undefined,
          status: statusFilter || undefined,
          search: searchQuery.trim() || undefined,
        });
        setClaimsData(data);
      } catch (err) {
        if (err instanceof ApiClientError) {
          toast.error("Failed to load claims", err.message);
        }
      } finally {
        setLoadingClaims(false);
      }
    },
    [user?.messId, statusFilter, searchQuery, toast],
  );

  // Fetch Policies
  const fetchPolicies = useCallback(async () => {
    try {
      const data = await api.get<PolicyItem[]>("/reimbursement-policy", {
        messId: user?.messId || "default",
      });
      setPolicies(data);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Failed to load policies", err.message);
      }
    }
  }, [user?.messId, toast]);

  useEffect(() => {
    fetchStats();
    fetchClaims(1);
  }, [fetchStats, fetchClaims]);

  useEffect(() => {
    if (activeTab === "policies") {
      fetchPolicies();
    }
  }, [activeTab, fetchPolicies]);

  // Open Claim Detail
  const handleOpenDetail = async (claimId: string) => {
    setStaleError(false);
    try {
      const claim = await api.get<ReimbursementClaim>(`/reimbursements/${claimId}`);
      setSelectedClaim(claim);
      // Pre-fill approve amount
      setApproveAmountRupees((claim.claimedAmountPaise / 100).toFixed(2));
      setApproveRemarks("");
      // Pre-fill payment amount
      const approved = claim.approvedAmountPaise || claim.claimedAmountPaise;
      const alreadyPaid = (claim.payments || []).reduce((s, p) => s + p.amountPaise, 0);
      const remaining = Math.max(0, approved - alreadyPaid);
      setPaymentForm({
        amountRupees: (remaining / 100).toFixed(2),
        method: "UPI",
        reference: "",
        note: "",
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Error", err.message);
      }
    }
  };

  // Start Review
  const handleStartReview = async () => {
    if (!selectedClaim) return;
    setActionLoading(true);
    try {
      const updated = await api.post<ReimbursementClaim>(
        `/reimbursements/${selectedClaim.id}/start-review`,
        { version: selectedClaim.version },
      );
      toast.success("Review Started", `Claim ${selectedClaim.publicRef} moved to Under Review.`);
      setSelectedClaim(updated);
      fetchStats();
      fetchClaims(claimsData.page);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "STALE_VERSION" || err.status === 409) {
          setStaleError(true);
        } else {
          toast.error("Action Failed", err.message);
        }
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Approve Claim
  const handleApproveSubmit = async () => {
    if (!selectedClaim) return;
    const amountPaise = Math.round(parseFloat(approveAmountRupees || "0") * 100);
    if (amountPaise <= 0) {
      toast.error("Invalid Amount", "Approved amount must be greater than zero.");
      return;
    }
    if (amountPaise > selectedClaim.claimedAmountPaise) {
      toast.error(
        "Over-approval Blocked",
        "Approved amount cannot exceed the student's claimed amount.",
      );
      return;
    }
    if (amountPaise < selectedClaim.claimedAmountPaise && !approveRemarks.trim()) {
      toast.error(
        "Remarks Required",
        "Mandatory remarks explaining the reduction are required when approving less than claimed.",
      );
      return;
    }

    setActionLoading(true);
    try {
      const updated = await api.post<ReimbursementClaim>(
        `/reimbursements/${selectedClaim.id}/approve`,
        {
          approvedAmountPaise: amountPaise,
          remarks: approveRemarks.trim() || undefined,
          version: selectedClaim.version,
        },
      );
      toast.success("Claim Approved", `Approved ₹${(amountPaise / 100).toFixed(2)}.`);
      setIsApproveOpen(false);
      setSelectedClaim(updated);
      fetchStats();
      fetchClaims(claimsData.page);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "STALE_VERSION" || err.status === 409) {
          setStaleError(true);
        } else {
          toast.error("Approval Failed", err.message);
        }
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Reject Claim
  const handleRejectSubmit = async () => {
    if (!selectedClaim) return;
    if (rejectReason.trim().length < 10) {
      toast.error("Reason Too Short", "Rejection reason must be at least 10 characters long.");
      return;
    }

    setActionLoading(true);
    try {
      const updated = await api.post<ReimbursementClaim>(
        `/reimbursements/${selectedClaim.id}/reject`,
        {
          reason: rejectReason.trim(),
          version: selectedClaim.version,
        },
      );
      toast.success("Claim Rejected", `Claim ${selectedClaim.publicRef} has been rejected.`);
      setIsRejectOpen(false);
      setSelectedClaim(updated);
      fetchStats();
      fetchClaims(claimsData.page);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "STALE_VERSION" || err.status === 409) {
          setStaleError(true);
        } else {
          toast.error("Rejection Failed", err.message);
        }
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Request Information
  const handleRequestInfoSubmit = async () => {
    if (!selectedClaim) return;
    if (infoMessage.trim().length < 5) {
      toast.error("Message Required", "Information request message must be at least 5 characters.");
      return;
    }

    setActionLoading(true);
    try {
      const updated = await api.post<ReimbursementClaim>(
        `/reimbursements/${selectedClaim.id}/request-info`,
        {
          message: infoMessage.trim(),
          version: selectedClaim.version,
        },
      );
      toast.success("Info Requested", "Student has been notified via WhatsApp.");
      setIsRequestInfoOpen(false);
      setSelectedClaim(updated);
      fetchStats();
      fetchClaims(claimsData.page);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "STALE_VERSION" || err.status === 409) {
          setStaleError(true);
        } else {
          toast.error("Request Failed", err.message);
        }
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Record Payment
  const handleRecordPaymentSubmit = async () => {
    if (!selectedClaim) return;
    const amountPaise = Math.round(parseFloat(paymentForm.amountRupees || "0") * 100);
    if (amountPaise <= 0) {
      toast.error("Invalid Amount", "Payment amount must be greater than zero.");
      return;
    }
    if (!paymentForm.reference.trim()) {
      toast.error("Reference Required", "Transaction / UPI reference number is required.");
      return;
    }

    setActionLoading(true);
    try {
      await api.post(`/reimbursements/${selectedClaim.id}/payments`, {
        amountPaise,
        method: paymentForm.method,
        reference: paymentForm.reference.trim(),
        note: paymentForm.note.trim() || undefined,
      });
      toast.success("Payment Recorded", `Recorded payment of ₹${(amountPaise / 100).toFixed(2)}.`);
      setIsRecordPaymentOpen(false);
      handleOpenDetail(selectedClaim.id);
      fetchStats();
      fetchClaims(claimsData.page);
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Payment Record Failed", err.message);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // View Document URL
  const handleViewDocument = async (docId: string) => {
    if (!selectedClaim) return;
    try {
      const res = await api.get<{ url: string }>(
        `/reimbursements/${selectedClaim.id}/documents/${docId}/url`,
      );
      window.open(res.url, "_blank");
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Document View Failed", err.message);
      }
    }
  };

  // Create Policy
  const handleCreatePolicySubmit = async () => {
    const dailyRatePaise = Math.round(parseFloat(policyForm.dailyRateRupees || "0") * 100);
    if (dailyRatePaise < 100) {
      toast.error("Invalid Rate", "Daily rebate rate must be at least ₹1.00");
      return;
    }

    setSavingPolicy(true);
    try {
      await api.post("/reimbursement-policy", {
        messId: user?.messId || "default",
        dailyRatePaise,
        minAbsenceDays: parseInt(policyForm.minAbsenceDays || "4", 10),
        effectiveFrom: policyForm.effectiveFrom,
        claimDeadlineDays: parseInt(policyForm.claimDeadlineDays || "30", 10),
        maxAbsenceDays: policyForm.maxAbsenceDays ? parseInt(policyForm.maxAbsenceDays, 10) : null,
        documentRequired: policyForm.documentRequired,
      });
      toast.success("Policy Created", "New immutable reimbursement policy published.");
      setIsCreatePolicyOpen(false);
      fetchPolicies();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast.error("Policy Creation Failed", err.message);
      }
    } finally {
      setSavingPolicy(false);
    }
  };

  // Table Columns
  const claimColumns: Column<ReimbursementClaim>[] = [
    {
      key: "publicRef",
      header: "Reference",
      render: (c) => (
        <span className="font-mono font-bold text-xs text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
          {c.publicRef}
        </span>
      ),
    },
    {
      key: "student",
      header: "Student",
      render: (c) => (
        <div>
          <p className="font-semibold text-slate-900 text-sm">{c.student.name}</p>
          <p className="text-xs text-slate-500 font-mono">
            {c.student.rollNo} • {c.student.department}
          </p>
        </div>
      ),
    },
    {
      key: "dates",
      header: "Absence Period",
      render: (c) => (
        <div className="text-xs text-slate-700">
          <ISTDateDisplay date={c.startDate} format="short" /> →{" "}
          <ISTDateDisplay date={c.endDate} format="short" />
        </div>
      ),
    },
    {
      key: "countedDays",
      header: "Counted Days",
      render: (c) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          {c.countedDays} days
        </span>
      ),
    },
    {
      key: "claimedAmountPaise",
      header: "Claimed Amount",
      render: (c) => (
        <CurrencyDisplay
          paise={c.claimedAmountPaise}
          className="font-semibold text-slate-800 text-xs"
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (c) => (
        <button
          type="button"
          onClick={() => handleOpenDetail(c.id)}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-200"
        >
          Review Claim
          <ArrowRight className="w-3 h-3" />
        </button>
      ),
    },
  ];

  const activePolicy = policies.find((p) => !p.effectiveUntil);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-600 rounded-xl text-white shadow-md shadow-blue-200">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Reimbursement Pipeline & Policy
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Review, approve, and disburse student absence rebates based on active daily policy.
            </p>
          </div>
        </div>

        {/* Tab Toggle */}
        <div className="bg-slate-100 p-1 rounded-xl flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab("pipeline")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "pipeline"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            Claims Pipeline
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("policies")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "policies"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Reimbursement Policies
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">Submitted</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-amber-600">{stats?.submitted ?? 0}</span>
            <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
              Pending
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">Under Review</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-blue-600">{stats?.underReview ?? 0}</span>
            <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
              Active
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">Approved</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-emerald-600">{stats?.approved ?? 0}</span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
              Awaiting Payout
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">Paid Out</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-slate-800">{stats?.paid ?? 0}</span>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
              Settled
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500">Info Requested</span>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold text-purple-600">{stats?.infoRequested ?? 0}</span>
            <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
              With Student
            </span>
          </div>
        </div>
      </div>

      {/* TAB 1: Claims Pipeline */}
      {activeTab === "pipeline" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          {/* Table Filters & Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search roll number, name or CLM ref..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchClaims(1)}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white"
              >
                <option value="">All Statuses</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="APPROVED">Approved</option>
                <option value="PAYMENT_PENDING">Payment Pending</option>
                <option value="PAID">Paid</option>
                <option value="INFO_REQUESTED">Info Requested</option>
                <option value="REJECTED">Rejected</option>
              </select>

              <button
                type="button"
                onClick={() => fetchClaims(1)}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Apply Filter
              </button>
            </div>
          </div>

          <DataTable
            columns={claimColumns}
            data={claimsData.items}
            loading={loadingClaims}
            page={claimsData.page}
            totalPages={claimsData.totalPages}
            totalItems={claimsData.total}
            onPageChange={(p) => fetchClaims(p)}
            emptyMessage="No reimbursement claims found matching the filters."
          />
        </div>
      )}

      {/* TAB 2: Policies Management (SUPER_ADMIN) */}
      {activeTab === "policies" && (
        <div className="space-y-6">
          {/* Active Policy Highlight Card */}
          {activePolicy && (
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl p-6 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/20 uppercase tracking-wider">
                  Active Policy in Effect
                </span>
                <h3 className="text-3xl font-extrabold mt-2">
                  ₹{(activePolicy.dailyRatePaise / 100).toFixed(2)}{" "}
                  <span className="text-lg font-medium text-emerald-100">/ day rebate</span>
                </h3>
                <p className="text-xs text-emerald-100 mt-1">
                  Requires strictly more than {activePolicy.minAbsenceDays} absence days (minimum{" "}
                  {activePolicy.minAbsenceDays + 1} counted days). Submission window:{" "}
                  {activePolicy.claimDeadlineDays} days.
                </p>
              </div>

              {user?.role === "SUPER_ADMIN" && (
                <button
                  type="button"
                  onClick={() => setIsCreatePolicyOpen(true)}
                  className="px-4 py-2.5 bg-white text-emerald-800 font-bold text-xs rounded-xl shadow-sm hover:bg-emerald-50 transition-colors flex items-center gap-1.5 self-start md:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  Adjust / Publish New Policy
                </button>
              )}
            </div>
          )}

          {/* Policy History Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4">Immutable Policy Audit Log</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Effective From</th>
                    <th className="py-2.5 px-3">Effective Until</th>
                    <th className="py-2.5 px-3">Daily Rate</th>
                    <th className="py-2.5 px-3">Min Absence</th>
                    <th className="py-2.5 px-3">Deadline Window</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {policies.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        <ISTDateDisplay date={p.effectiveFrom} format="short" />
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {p.effectiveUntil ? (
                          <ISTDateDisplay date={p.effectiveUntil} format="short" />
                        ) : (
                          "Present (Ongoing)"
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        ₹{(p.dailyRatePaise / 100).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        &gt; {p.minAbsenceDays} days (counted ≥ {p.minAbsenceDays + 1})
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{p.claimDeadlineDays} days</td>
                      <td className="py-2.5 px-3">
                        {!p.effectiveUntil ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                            Closed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL MODAL / DRAWER */}
      {selectedClaim && (
        <Modal
          isOpen={Boolean(selectedClaim)}
          onClose={() => setSelectedClaim(null)}
          title={`Claim ${selectedClaim.publicRef}`}
          maxWidth="2xl"
        >
          <div className="space-y-6">
            {/* Stale Concurrency Error Banner */}
            {staleError && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-amber-800 text-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    This claim was modified concurrently by another administrator. Please reload to
                    see updated details.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenDetail(selectedClaim.id)}
                  className="px-2 py-1 bg-amber-200 hover:bg-amber-300 rounded font-bold text-amber-900"
                >
                  Reload
                </button>
              </div>
            )}

            {/* Student Snapshot Header */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row justify-between gap-4">
              <div>
                <span className="text-xs text-slate-500 font-mono">Student Profile (Snapshot)</span>
                <h4 className="font-bold text-base text-slate-900">{selectedClaim.student.name}</h4>
                <p className="text-xs text-slate-600 font-mono">
                  {selectedClaim.student.rollNo} • {selectedClaim.student.department} • Mess:{" "}
                  {selectedClaim.mess.code}
                </p>
              </div>
              <div className="text-right">
                <StatusBadge status={selectedClaim.status} />
                <p className="text-xs text-slate-400 mt-1">Version: {selectedClaim.version}</p>
              </div>
            </div>

            {/* Authoritative Calculation Breakdown */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h5 className="font-bold text-xs uppercase tracking-wider text-slate-500">
                ADR A1 Calculation Breakdown
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block">Departure (Excluded)</span>
                  <ISTDateDisplay
                    date={selectedClaim.startDate}
                    format="short"
                    className="font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <span className="text-slate-400 block">Return (Excluded)</span>
                  <ISTDateDisplay
                    date={selectedClaim.endDate}
                    format="short"
                    className="font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <span className="text-slate-400 block">Counted Days</span>
                  <span className="font-bold text-blue-700">
                    {selectedClaim.countedDays} full days
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Claimed Total</span>
                  <CurrencyDisplay
                    paise={selectedClaim.claimedAmountPaise}
                    className="font-bold text-emerald-700"
                  />
                </div>
              </div>

              {selectedClaim.reason && (
                <div className="pt-2 border-t border-slate-100 text-xs">
                  <span className="text-slate-400 block">Student Absence Reason:</span>
                  <p className="text-slate-700 italic mt-0.5">{selectedClaim.reason}</p>
                </div>
              )}

              {selectedClaim.maskedPayout && (
                <div className="pt-2 border-t border-slate-100 text-xs flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-500">Encrypted Payout Account:</span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedClaim.maskedPayout}
                  </span>
                </div>
              )}
            </div>

            {/* Supporting Documents */}
            {selectedClaim.documents && selectedClaim.documents.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h5 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-2">
                  Uploaded Leave Documents
                </h5>
                <div className="space-y-2">
                  {selectedClaim.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        <span className="font-medium text-slate-800">{doc.originalName}</span>
                        <span className="text-slate-400">
                          ({Math.round(doc.sizeBytes / 1024)} KB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleViewDocument(doc.id)}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-blue-600 hover:bg-slate-50 font-semibold"
                      >
                        View Signed Document
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline of Status History */}
            {selectedClaim.statusHistory && selectedClaim.statusHistory.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 max-h-48 overflow-y-auto">
                <h5 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-2">
                  Lifecycle Timeline
                </h5>
                <div className="space-y-2 text-xs">
                  {selectedClaim.statusHistory.map((h) => (
                    <div key={h.id} className="flex items-start gap-2 text-slate-600">
                      <Clock className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                      <div>
                        <span className="font-semibold text-slate-800">
                          {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus}
                        </span>{" "}
                        <span className="text-slate-400">by {h.actorType} • </span>
                        <ISTDateDisplay date={h.at} format="datetime" className="text-slate-400" />
                        {h.remarks && <p className="text-slate-700 italic mt-0.5">"{h.remarks}"</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-3">
              {selectedClaim.status === "SUBMITTED" && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleStartReview}
                  className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
                >
                  Start Review
                </button>
              )}

              {selectedClaim.status === "UNDER_REVIEW" && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsRequestInfoOpen(true)}
                    className="px-3 py-2 bg-purple-50 text-purple-700 border border-purple-200 text-xs font-bold rounded-xl hover:bg-purple-100"
                  >
                    Request Info
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRejectOpen(true)}
                    className="px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold rounded-xl hover:bg-rose-100"
                  >
                    Reject Claim
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsApproveOpen(true)}
                    className="px-5 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700"
                  >
                    Approve Claim
                  </button>
                </>
              )}

              {(selectedClaim.status === "APPROVED" ||
                selectedClaim.status === "PAYMENT_PENDING") && (
                <button
                  type="button"
                  onClick={() => setIsRecordPaymentOpen(true)}
                  className="px-5 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 flex items-center gap-1.5"
                >
                  <DollarSign className="w-4 h-4" />
                  Record Payout
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* APPROVE SUB-MODAL */}
      {isApproveOpen && selectedClaim && (
        <Modal
          isOpen={isApproveOpen}
          onClose={() => setIsApproveOpen(false)}
          title={`Approve Claim: ${selectedClaim.publicRef}`}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Approved Amount (₹)</label>
              <input
                type="number"
                step="0.01"
                value={approveAmountRupees}
                onChange={(e) => setApproveAmountRupees(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-900"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Student claimed: ₹{(selectedClaim.claimedAmountPaise / 100).toFixed(2)}. Approvals
                cannot exceed this total.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Remarks{" "}
                {parseFloat(approveAmountRupees || "0") <
                  selectedClaim.claimedAmountPaise / 100 && (
                  <span className="text-rose-500 font-bold">* (Mandatory for reductions)</span>
                )}
              </label>
              <textarea
                value={approveRemarks}
                onChange={(e) => setApproveRemarks(e.target.value)}
                rows={3}
                placeholder="Reason for approval / explanation of any reduction..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsApproveOpen(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleApproveSubmit}
                className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                Confirm Approval
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* REJECT SUB-MODAL */}
      {isRejectOpen && selectedClaim && (
        <Modal
          isOpen={isRejectOpen}
          onClose={() => setIsRejectOpen(false)}
          title={`Reject Claim: ${selectedClaim.publicRef}`}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Rejection Reason <span className="text-rose-500">* (Min 10 characters)</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Explain why this absence claim is rejected (e.g. leave cancelled, insufficient documentation)..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsRejectOpen(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || rejectReason.trim().length < 10}
                onClick={handleRejectSubmit}
                className="px-4 py-1.5 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* REQUEST INFO SUB-MODAL */}
      {isRequestInfoOpen && selectedClaim && (
        <Modal
          isOpen={isRequestInfoOpen}
          onClose={() => setIsRequestInfoOpen(false)}
          title={`Request Information: ${selectedClaim.publicRef}`}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Message for Student <span className="text-purple-600">* (Sent via WhatsApp)</span>
              </label>
              <textarea
                value={infoMessage}
                onChange={(e) => setInfoMessage(e.target.value)}
                rows={3}
                placeholder="Specify what document or proof the student needs to upload..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsRequestInfoOpen(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || infoMessage.trim().length < 5}
                onClick={handleRequestInfoSubmit}
                className="px-4 py-1.5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                Send Request
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* RECORD PAYMENT SUB-MODAL */}
      {isRecordPaymentOpen && selectedClaim && (
        <Modal
          isOpen={isRecordPaymentOpen}
          onClose={() => setIsRecordPaymentOpen(false)}
          title={`Record Payout: ${selectedClaim.publicRef}`}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Amount to Disburse (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={paymentForm.amountRupees}
                onChange={(e) => setPaymentForm({ ...paymentForm, amountRupees: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
              <select
                value={paymentForm.method}
                onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                <option value="CASH">Cash</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Transaction Reference
              </label>
              <input
                type="text"
                placeholder="e.g. UPI/2026/891238 or UTR number"
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Note (Optional)</label>
              <input
                type="text"
                placeholder="Optional notes"
                value={paymentForm.note}
                onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsRecordPaymentOpen(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !paymentForm.reference.trim()}
                onClick={handleRecordPaymentSubmit}
                className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                Record Disbursal
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* CREATE POLICY MODAL (SUPER_ADMIN) */}
      {isCreatePolicyOpen && (
        <Modal
          isOpen={isCreatePolicyOpen}
          onClose={() => setIsCreatePolicyOpen(false)}
          title="Publish New Reimbursement Policy"
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
              <p className="font-semibold">Immutable Policy Rule:</p>
              <p className="mt-0.5">
                Creating this policy will automatically close the previous active policy on the day
                before the new effective date.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Daily Rebate Rate (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={policyForm.dailyRateRupees}
                onChange={(e) => setPolicyForm({ ...policyForm, dailyRateRupees: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Effective From (IST)
                </label>
                <input
                  type="date"
                  value={policyForm.effectiveFrom}
                  onChange={(e) => setPolicyForm({ ...policyForm, effectiveFrom: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Min Absence Days</label>
                <input
                  type="number"
                  value={policyForm.minAbsenceDays}
                  onChange={(e) => setPolicyForm({ ...policyForm, minAbsenceDays: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Claim Deadline Window (Days)
              </label>
              <input
                type="number"
                value={policyForm.claimDeadlineDays}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, claimDeadlineDays: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="docRequired"
                checked={policyForm.documentRequired}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, documentRequired: e.target.checked })
                }
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <label htmlFor="docRequired" className="font-semibold text-slate-700">
                Mandatory Leave Document Upload
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsCreatePolicyOpen(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingPolicy}
                onClick={handleCreatePolicySubmit}
                className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                Publish Policy
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
