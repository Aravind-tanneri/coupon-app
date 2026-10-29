import { ReimbursementStatus } from "@prisma/client";
import { BusinessRuleError, StaleVersionError } from "../../lib/errors.js";

export const ALLOWED_TRANSITIONS: Record<
  ReimbursementStatus,
  ReadonlyArray<ReimbursementStatus>
> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "INFO_REQUESTED", "CANCELLED"],
  INFO_REQUESTED: ["SUBMITTED", "CANCELLED"],
  APPROVED: ["PAYMENT_PENDING"],
  PAYMENT_PENDING: ["PAID", "PAYMENT_FAILED"],
  PAYMENT_FAILED: ["PAYMENT_PENDING"],
  PAID: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: ReimbursementStatus, to: ReimbursementStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export interface TransitionPayload {
  approvedAmountPaise?: number;
  remarks?: string;
  rejectionReason?: string;
  expectedVersion?: number;
}

export function validateTransition(
  from: ReimbursementStatus,
  to: ReimbursementStatus,
  claimedAmountPaise: number,
  payload: TransitionPayload = {},
) {
  if (!canTransition(from, to)) {
    throw new BusinessRuleError(
      "INVALID_STATUS_TRANSITION",
      `Cannot transition claim from ${from} to ${to}.`,
    );
  }

  if (to === "APPROVED") {
    if (
      payload.approvedAmountPaise === undefined ||
      payload.approvedAmountPaise === null ||
      payload.approvedAmountPaise <= 0
    ) {
      throw new BusinessRuleError(
        "INVALID_APPROVED_AMOUNT",
        "Approved amount is required and must be greater than zero.",
      );
    }

    if (payload.approvedAmountPaise > claimedAmountPaise) {
      throw new BusinessRuleError(
        "APPROVAL_EXCEEDS_CLAIM",
        `Approved amount (₹${(payload.approvedAmountPaise / 100).toFixed(2)}) cannot exceed claimed amount (₹${(claimedAmountPaise / 100).toFixed(2)}).`,
      );
    }

    if (
      payload.approvedAmountPaise < claimedAmountPaise &&
      (!payload.remarks || payload.remarks.trim().length === 0)
    ) {
      throw new BusinessRuleError(
        "REDUCTION_REMARK_REQUIRED",
        "Mandatory remarks explaining the reduction are required when approving less than claimed amount.",
      );
    }
  }

  if (to === "REJECTED") {
    const reason = payload.rejectionReason || payload.remarks;
    if (!reason || reason.trim().length < 10) {
      throw new BusinessRuleError(
        "REJECTION_REASON_REQUIRED",
        "Rejection reason must be at least 10 characters long.",
      );
    }
  }

  if (to === "INFO_REQUESTED") {
    if (!payload.remarks || payload.remarks.trim().length < 5) {
      throw new BusinessRuleError(
        "INFO_REQUEST_MESSAGE_REQUIRED",
        "A clear message for the student explaining what information is needed is required (min 5 characters).",
      );
    }
  }
}

export function assertVersionMatch(actualVersion: number, expectedVersion?: number) {
  if (expectedVersion !== undefined && actualVersion !== expectedVersion) {
    throw new StaleVersionError(
      "Claim was modified concurrently by another user. Please reload the claim.",
    );
  }
}
