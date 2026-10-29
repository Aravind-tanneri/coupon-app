import { z } from "zod";
import { MealType, CouponStatus, CouponSource } from "@prisma/client";

export const CreateCouponProductSchema = z.object({
  messId: z.string().min(1, "Mess ID is required"),
  code: z
    .string()
    .min(1, "Product code is required")
    .max(50)
    .transform((val) => val.trim().toUpperCase()),
  mealType: z.nativeEnum(MealType),
  pricePaise: z.number().int().min(0, "Price must be non-negative in paise"),
  dailyCap: z.number().int().min(1, "Daily cap must be at least 1").optional(),
  active: z.boolean().default(true),
});

export type CreateCouponProductInput = z.infer<typeof CreateCouponProductSchema>;

export const UpdateCouponProductSchema = z.object({
  pricePaise: z.number().int().min(0, "Price must be non-negative in paise").optional(),
  dailyCap: z.number().int().min(1).nullable().optional(),
  active: z.boolean().optional(),
});

export type UpdateCouponProductInput = z.infer<typeof UpdateCouponProductSchema>;

export const CreateCouponOrderSchema = z.object({
  studentId: z.string().min(1, "Student ID is required"),
  productId: z.string().min(1, "Product ID is required"),
  validDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validDate must be in YYYY-MM-DD format"),
  idempotencyKey: z.string().min(8, "Idempotency key required"),
});

export type CreateCouponOrderInput = z.infer<typeof CreateCouponOrderSchema>;

export const VerifyPaymentSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  razorpayPaymentId: z.string().min(1, "Payment ID is required"),
  razorpaySignature: z.string().min(1, "Signature is required"),
});

export type VerifyPaymentInput = z.infer<typeof VerifyPaymentSchema>;

export const CouponListQuerySchema = z.object({
  messId: z.string().optional(),
  studentId: z.string().optional(),
  productId: z.string().optional(),
  mealType: z.nativeEnum(MealType).optional(),
  status: z.nativeEnum(CouponStatus).optional(),
  source: z.nativeEnum(CouponSource).optional(),
  validDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  search: z.string().optional(), // search by shortCode, student roll, or student name
  page: z
    .string()
    .optional()
    .default("1")
    .transform((val) => Math.max(1, parseInt(val, 10) || 1)),
  pageSize: z
    .string()
    .optional()
    .default("20")
    .transform((val) => Math.min(100, Math.max(1, parseInt(val, 10) || 20))),
});

export type CouponListQuery = z.infer<typeof CouponListQuerySchema>;
