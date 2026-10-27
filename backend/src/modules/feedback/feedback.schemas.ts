import { z } from "zod";
import { FeedbackCategory, FeedbackStatus, MealType } from "@prisma/client";

export const SubmitFeedbackSchema = z.object({
  messId: z.string().min(1, "Mess ID is required"),
  studentId: z.string().min(1, "Student ID is required"),
  category: z.nativeEnum(FeedbackCategory),
  message: z
    .string()
    .min(3, "Message must be at least 3 characters")
    .max(1000, "Message cannot exceed 1000 characters"),
  rating: z
    .number()
    .int("Rating must be an integer")
    .min(1, "Rating must be at least 1")
    .max(5, "Rating cannot exceed 5")
    .optional(),
  mealType: z.nativeEnum(MealType).optional(),
  isAnonymous: z.boolean().default(false),
  imageDocId: z.string().optional(),
});

export type SubmitFeedbackInput = z.infer<typeof SubmitFeedbackSchema>;

export const FeedbackListQuerySchema = z.object({
  messId: z.string().optional(),
  status: z.nativeEnum(FeedbackStatus).optional(),
  category: z.nativeEnum(FeedbackCategory).optional(),
  rating: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  mealType: z.nativeEnum(MealType).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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

export type FeedbackListQuery = z.infer<typeof FeedbackListQuerySchema>;

export const UpdateFeedbackStatusSchema = z.object({
  status: z.nativeEnum(FeedbackStatus),
  adminNote: z.string().max(500).optional(),
});

export type UpdateFeedbackStatusInput = z.infer<typeof UpdateFeedbackStatusSchema>;
