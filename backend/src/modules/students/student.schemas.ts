import { z } from "zod";

export const StudentCsvRowSchema = z.object({
  rollNo: z
    .string()
    .min(1, "Roll number is required")
    .max(50, "Roll number too long")
    .transform((val) => val.trim().toUpperCase()),
  name: z
    .string()
    .min(1, "Name is required")
    .max(120, "Name too long")
    .transform((val) => val.trim()),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email format")
    .max(120, "Email too long")
    .transform((val) => val.trim().toLowerCase()),
  department: z
    .string()
    .min(1, "Department is required")
    .max(100, "Department too long")
    .transform((val) => val.trim()),
  mess: z
    .string()
    .max(100)
    .optional()
    .transform((val) => (val ? val.trim() : undefined)),
});

export type StudentCsvRow = z.infer<typeof StudentCsvRowSchema>;

export const StudentListQuerySchema = z.object({
  search: z.string().optional(),
  messId: z.string().optional(),
  active: z
    .string()
    .optional()
    .transform((val) => (val === undefined ? undefined : val === "true")),
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

export type StudentListQuery = z.infer<typeof StudentListQuerySchema>;

export const StudentRosterImportOptionsSchema = z.object({
  dryRun: z
    .union([z.boolean(), z.string().transform((val) => val === "true")])
    .optional()
    .default(false),
  defaultMessId: z.string().optional(),
});

export type StudentRosterImportOptions = z.infer<typeof StudentRosterImportOptionsSchema>;
