import { z } from "zod";
import { MealType } from "@prisma/client";

export const MenuItemSchema = z.object({
  name: z.string().min(1, "Item name is required").max(100),
  isVeg: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type MenuItemInput = z.infer<typeof MenuItemSchema>;

export const UpsertMealSlotSchema = z.object({
  messId: z.string().min(1, "Mess ID is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  mealType: z.nativeEnum(MealType),
  notes: z.string().max(255).optional(),
  items: z.array(MenuItemSchema).min(1, "At least one menu item is required"),
});

export type UpsertMealSlotInput = z.infer<typeof UpsertMealSlotSchema>;

export const CopyWeekMenuSchema = z.object({
  messId: z.string().min(1, "Mess ID is required"),
  sourceStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "sourceStartDate must be in YYYY-MM-DD format"),
  targetStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "targetStartDate must be in YYYY-MM-DD format"),
});

export type CopyWeekMenuInput = z.infer<typeof CopyWeekMenuSchema>;

export const MenuQuerySchema = z.object({
  messId: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be in YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be in YYYY-MM-DD format"),
});

export type MenuQuery = z.infer<typeof MenuQuerySchema>;
