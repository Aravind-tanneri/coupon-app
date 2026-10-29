import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DEFAULT_MESS_CODE: z.string().min(1).default("AKSHAYA"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters long"),
  PAYOUT_ENCRYPTION_KEY: z.string().min(16, "PAYOUT_ENCRYPTION_KEY is required"),
  SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().email().default("mess@campus.edu"),

  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(input: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => ` - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${errorDetails}`);
  }
  return result.data;
}

// In test environment, provide fallback dummy secrets if not set
const rawEnv: Record<string, string | undefined> = { ...process.env };
if (rawEnv.NODE_ENV === "test") {
  rawEnv.DATABASE_URL =
    rawEnv.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/campus_mess_test";
  rawEnv.SESSION_SECRET = rawEnv.SESSION_SECRET ?? "0123456789abcdef0123456789abcdef";
  rawEnv.PAYOUT_ENCRYPTION_KEY = rawEnv.PAYOUT_ENCRYPTION_KEY ?? "0123456789abcdef0123456789abcdef";
  rawEnv.WHATSAPP_WEBHOOK_VERIFY_TOKEN =
    rawEnv.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "test_webhook_verify_token";
  rawEnv.WHATSAPP_APP_SECRET = rawEnv.WHATSAPP_APP_SECRET ?? "test_whatsapp_app_secret";
}

let cachedEnv: Env | null = null;
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = validateEnv(rawEnv);
  }
  return cachedEnv;
}

export const env: Env = getEnv();
