import { describe, it, expect } from "vitest";
import { validateEnv } from "./env.js";

describe("Environment Validation", () => {
  const validBaseEnv = {
    NODE_ENV: "development",
    PORT: "3000",
    FRONTEND_URL: "http://localhost:5173",
    DATABASE_URL: "postgresql://postgres:secret@localhost:5432/campus_mess",
    DEFAULT_MESS_CODE: "AKSHAYA",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    PAYOUT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  };

  it("successfully parses valid environment variables", () => {
    const parsed = validateEnv(validBaseEnv);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.DATABASE_URL).toBe(validBaseEnv.DATABASE_URL);
    expect(parsed.DEFAULT_MESS_CODE).toBe("AKSHAYA");
  });

  it("throws a descriptive error when required variables are missing", () => {
    const invalidEnv = { ...validBaseEnv, DATABASE_URL: "" };
    expect(() => validateEnv(invalidEnv)).toThrowError(
      /Environment validation failed:[\s\S]*DATABASE_URL/,
    );
  });

  it("validates SESSION_SECRET minimum length (32 chars)", () => {
    const shortSecretEnv = { ...validBaseEnv, SESSION_SECRET: "too_short" };
    expect(() => validateEnv(shortSecretEnv)).toThrowError(
      /SESSION_SECRET must be at least 32 characters long/,
    );
  });

  it("applies defaults for omitted optional fields", () => {
    const minimalEnv = {
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/campus_mess",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      PAYOUT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    };
    const parsed = validateEnv(minimalEnv);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.DEFAULT_MESS_CODE).toBe("AKSHAYA");
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.GEMINI_MODEL).toBe("gemini-2.0-flash");
  });
});
