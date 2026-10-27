import React from "react";

export type StatusVariant = "success" | "warning" | "danger" | "info" | "neutral" | "purple";

export interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  className?: string;
  dot?: boolean;
}

const STATUS_COLOR_MAP: Record<string, { bg: string; text: string; dot: string }> = {
  // Common states
  ACTIVE: {
    bg: "bg-emerald-50",
    text: "text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  LINKED: {
    bg: "bg-emerald-50",
    text: "text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  APPROVED: {
    bg: "bg-emerald-50",
    text: "text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  PAID: { bg: "bg-emerald-50", text: "text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  SUCCEEDED: {
    bg: "bg-emerald-50",
    text: "text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  SENT: { bg: "bg-emerald-50", text: "text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },

  // Warnings / Pending
  PENDING: { bg: "bg-amber-50", text: "text-amber-700 border-amber-200", dot: "bg-amber-500" },
  SUBMITTED: { bg: "bg-amber-50", text: "text-amber-700 border-amber-200", dot: "bg-amber-500" },
  UNDER_REVIEW: { bg: "bg-amber-50", text: "text-amber-700 border-amber-200", dot: "bg-amber-500" },
  PAYMENT_PENDING: {
    bg: "bg-amber-50",
    text: "text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  INFO_REQUESTED: {
    bg: "bg-amber-50",
    text: "text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },

  // Danger / Errors
  FAILED: { bg: "bg-rose-50", text: "text-rose-700 border-rose-200", dot: "bg-rose-500" },
  REJECTED: { bg: "bg-rose-50", text: "text-rose-700 border-rose-200", dot: "bg-rose-500" },
  REVOKED: { bg: "bg-rose-50", text: "text-rose-700 border-rose-200", dot: "bg-rose-500" },
  EXPIRED: { bg: "bg-slate-100", text: "text-slate-600 border-slate-200", dot: "bg-slate-400" },
  CANCELLED: { bg: "bg-slate-100", text: "text-slate-600 border-slate-200", dot: "bg-slate-400" },
  NOT_LINKED: { bg: "bg-slate-100", text: "text-slate-600 border-slate-200", dot: "bg-slate-400" },
  INACTIVE: { bg: "bg-slate-100", text: "text-slate-600 border-slate-200", dot: "bg-slate-400" },

  // Info
  REDEEMED: { bg: "bg-blue-50", text: "text-blue-700 border-blue-200", dot: "bg-blue-500" },
  DRAFT: { bg: "bg-slate-100", text: "text-slate-700 border-slate-200", dot: "bg-slate-400" },
  NEW: { bg: "bg-indigo-50", text: "text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = "", dot = true }) => {
  const normalized = status.toUpperCase().replace(/\s+/g, "_");
  const color = STATUS_COLOR_MAP[normalized] || {
    bg: "bg-slate-50",
    text: "text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  };

  const label = status.replace(/_/g, " ");

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${color.bg} ${color.text} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />}
      {label}
    </span>
  );
};
