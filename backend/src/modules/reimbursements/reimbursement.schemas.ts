import { z } from "zod";
import { ReimbursementStatus, PaymentMethod } from "@prisma/client";

export const CreatePolicySchema = z.object({
  messId: z.string().min(1, "Mess ID is required"),
  dailyRatePaise: z.number().int().min(100, "Daily rate must be at least ₹1.00 (100 paise)"),
  minAbsenceDays: z.number().int().min(1).default(4),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD format"),
  claimDeadlineDays: z.number().int().min(0).default(30),
  maxAbsenceDays: z.number().int().min(1).nullable().optional(),
  documentRequired: z.boolean().default(false),
});

export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>;

export const CalculateClaimQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD format"),
  messId: z.string().optional(),
  studentId: z.string().optional(),
});

export type CalculateClaimQuery = z.infer<typeof CalculateClaimQuerySchema>;

export const SaveDraftClaimSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD format"),
  reason: z.string().max(500).optional(),
  payoutDetails: z.string().max(100).optional(),
});

export type SaveDraftClaimInput = z.infer<typeof SaveDraftClaimSchema>;

export const ApproveClaimSchema = z.object({
  approvedAmountPaise: z.number().int().min(1, "Approved amount must be greater than zero"),
  remarks: z.string().optional(),
  version: z.number().int().min(1),
});

export type ApproveClaimInput = z.infer<typeof ApproveClaimSchema>;

export const RejectClaimSchema = z.object({
  reason: z.string().min(10, "Rejection reason must be at least 10 characters long"),
  version: z.number().int().min(1),
});

export type RejectClaimInput = z.infer<typeof RejectClaimSchema>;

export const RequestInfoSchema = z.object({
  message: z.string().min(5, "Information request message must be at least 5 characters long"),
  version: z.number().int().min(1),
});

export type RequestInfoInput = z.infer<typeof RequestInfoSchema>;

export const RecordPaymentSchema = z.object({
  amountPaise: z.number().int().min(1, "Payment amount must be greater than zero"),
  method: z.nativeEnum(PaymentMethod),
  reference: z.string().min(2, "Reference is required"),
  paidAt: z.string().optional(),
  note: z.string().optional(),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

export const ClaimListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  messId: z.string().optional(),
  status: z.nativeEnum(ReimbursementStatus).optional(),
  studentId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
});

export type ClaimListQuery = z.infer<typeof ClaimListQuerySchema>;
