import { z } from "zod";
import { AdminRole } from "@prisma/client";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(12, "New password must be at least 12 characters long"),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(12, "Password must be at least 12 characters long"),
  name: z.string().min(1, "Name is required").trim(),
  role: z.nativeEnum(AdminRole),
  messId: z.string().nullable().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).trim().optional(),
  role: z.nativeEnum(AdminRole).optional(),
  messId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
