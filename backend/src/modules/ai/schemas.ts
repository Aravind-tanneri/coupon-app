import { z } from "zod";
import { AI_INTENTS } from "./gemini.types.js";

/**
 * Structured Output JSON Schema for Intent Classification (§13.2).
 */
export const INTENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: {
      type: "STRING",
      enum: AI_INTENTS,
      description: "Primary user intent classification",
    },
    entities: {
      type: "OBJECT",
      properties: {
        date: { type: "STRING", description: "Target date in YYYY-MM-DD format" },
        meal: {
          type: "STRING",
          enum: ["BREAKFAST", "LUNCH", "SNACKS", "DINNER", "SPECIAL_DINNER"],
          description: "Target meal window",
        },
        category: {
          type: "STRING",
          description: "Feedback category (e.g., FOOD_QUALITY, HYGIENE, TIMELINESS)",
        },
        rating: { type: "INTEGER", description: "Star rating between 1 and 5" },
        message: { type: "STRING", description: "Freeform message or remarks" },
        productCode: { type: "STRING", description: "Coupon product code" },
        startDate: { type: "STRING", description: "Absence start date in YYYY-MM-DD format" },
        endDate: { type: "STRING", description: "Absence return date in YYYY-MM-DD format" },
        ref: { type: "STRING", description: "Reference code, short ref (#1, #2), or claim ID" },
        days: { type: "INTEGER", description: "Number of upcoming days to query (1-7)" },
      },
    },
    confidence: {
      type: "NUMBER",
      description: "Confidence score between 0.0 and 1.0",
    },
  },
  required: ["intent", "confidence"],
} as const;

/**
 * Tool Argument Schemas (§13.3)
 * STRICT RULE: No tool parameter may accept studentId, userId, or messId.
 * Identity is strictly injected by backend context.
 */

export const GetMenuArgsSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
      .optional(),
    meal: z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER", "SPECIAL_DINNER"]).optional(),
  })
  .strict();

export const ListUpcomingMenusArgsSchema = z
  .object({
    days: z.number().int().min(1).max(7).default(3).optional(),
  })
  .strict();

export const GetMyCouponsArgsSchema = z
  .object({
    status: z.enum(["ACTIVE", "REDEEMED", "EXPIRED", "REVOKED"]).optional(),
  })
  .strict();

export const GetMyGiftCouponsArgsSchema = z.object({}).strict();

export const GetCouponQrArgsSchema = z
  .object({
    ref: z.string().min(1, "Reference code is required"),
  })
  .strict();

export const ListCouponProductsArgsSchema = z.object({}).strict();

export const StartCouponPurchaseArgsSchema = z
  .object({
    productCode: z.string().min(1, "Product code is required"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  })
  .strict();

export const GetPaymentStatusArgsSchema = z
  .object({
    ref: z.string().min(1, "Payment order reference is required"),
  })
  .strict();

export const GetReimbursementPolicyArgsSchema = z.object({}).strict();

export const CalculateReimbursementArgsSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD"),
  })
  .strict();

export const StartReimbursementClaimArgsSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD")
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD")
      .optional(),
  })
  .strict();

export const GetMyReimbursementsArgsSchema = z
  .object({
    ref: z.string().optional(),
  })
  .strict();

export const SubmitFeedbackDraftArgsSchema = z
  .object({
    category: z.string().min(1, "Category is required"),
    message: z.string().min(1, "Message is required"),
    rating: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export const GetAnnouncementsArgsSchema = z.object({}).strict();

export const ShowHelpArgsSchema = z.object({}).strict();

export const CancelFlowArgsSchema = z.object({}).strict();
