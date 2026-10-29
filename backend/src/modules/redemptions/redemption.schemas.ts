import { z } from "zod";
import { MealType } from "@prisma/client";

export const LookupCouponSchema = z
  .object({
    token: z.string().optional(),
    shortCode: z.string().optional(),
    skipMealWindowCheck: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.token || data.shortCode), {
    message: "Either token or shortCode must be provided",
  });

export type LookupCouponInput = z.infer<typeof LookupCouponSchema>;

export const RedeemCouponSchema = z
  .object({
    token: z.string().optional(),
    shortCode: z.string().optional(),
    skipMealWindowCheck: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.token || data.shortCode), {
    message: "Either token or shortCode must be provided",
  });

export type RedeemCouponInput = z.infer<typeof RedeemCouponSchema>;

export const RedemptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  messId: z.string().optional(),
  mealType: z.nativeEnum(MealType).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
    .optional(),
  search: z.string().optional(),
});

export type RedemptionListQuery = z.infer<typeof RedemptionListQuerySchema>;
