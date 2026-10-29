import { z } from "zod";

export const IssueGiftBatchSchema = z.object({
  messId: z.string().min(1, "messId is required"),
  mealDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "mealDate must be in YYYY-MM-DD format"),
  studentIds: z
    .array(z.string().min(1))
    .min(1, "At least one student must be selected")
    .max(300, "Maximum 300 students per batch"),
  message: z.string().max(255).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

export type IssueGiftBatchInput = z.infer<typeof IssueGiftBatchSchema>;

export const ListGiftBatchesQuerySchema = z.object({
  messId: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type ListGiftBatchesQuery = z.infer<typeof ListGiftBatchesQuerySchema>;

export const RevokeGiftCouponSchema = z.object({
  reason: z.string().max(255).optional(),
});

export type RevokeGiftCouponInput = z.infer<typeof RevokeGiftCouponSchema>;

export const ResendGiftNotificationsSchema = z.object({
  channel: z.enum(["ALL", "EMAIL", "WHATSAPP"]).default("ALL"),
  itemId: z.string().optional(),
});

export type ResendGiftNotificationsInput = z.infer<typeof ResendGiftNotificationsSchema>;
