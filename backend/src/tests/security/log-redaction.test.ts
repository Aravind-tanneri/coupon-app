import { describe, it, expect } from "vitest";
import { pino } from "pino";
import { Writable } from "stream";

describe("Phase 24 / §23 Security Hardening: Log Redaction Verification (§24.4)", () => {
  it("redacts sensitive fields (phones, passwords, tokens, OTPs, payout accounts) from structured log output", async () => {
    let capturedLog = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        capturedLog += chunk.toString();
        callback();
      },
    });

    const testLogger = pino(
      {
        level: "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "password",
            "passwordHash",
            "token",
            "tokenHash",
            "otp",
            "phone",
            "payoutDetails",
            "encryptedPayout",
            "accountNumber",
            "upiId",
            "*.password",
            "*.passwordHash",
            "*.token",
            "*.tokenHash",
            "*.otp",
            "*.phone",
            "*.payoutDetails",
            "*.encryptedPayout",
            "*.accountNumber",
            "*.upiId",
          ],
          censor: "[REDACTED]",
        },
      },
      stream,
    );

    // Emit logs with sensitive credentials and PII
    testLogger.info({
      event: "STUDENT_LOGIN_ATTEMPT",
      phone: "+919876543210",
      otp: "982143",
      password: "SuperSecretPassword123!",
      token: "secret_access_token_abc_xyz",
      payoutDetails: {
        accountNumber: "98765432101234",
        upiId: "student@upi",
      },
      bankInfo: {
        accountNumber: "11223344556677",
        upiId: "alt_student@upi",
      },
      req: {
        headers: {
          authorization: "Bearer sensitive_jwt_token",
          cookie: "session_id=s_abcdef1234567890",
        },
      },
      safeMetadata: {
        rollNo: "2024CS001",
        mess: "AKSHAYA",
      },
    });

    const parsed = JSON.parse(capturedLog);

    // Verify top-level sensitive data is replaced by [REDACTED]
    expect(parsed.phone).toBe("[REDACTED]");
    expect(parsed.otp).toBe("[REDACTED]");
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.payoutDetails).toBe("[REDACTED]");
    expect(parsed.bankInfo.accountNumber).toBe("[REDACTED]");
    expect(parsed.bankInfo.upiId).toBe("[REDACTED]");
    expect(parsed.req.headers.authorization).toBe("[REDACTED]");
    expect(parsed.req.headers.cookie).toBe("[REDACTED]");

    // Verify non-sensitive metadata is intact
    expect(parsed.safeMetadata.rollNo).toBe("2024CS001");
    expect(parsed.safeMetadata.mess).toBe("AKSHAYA");

    // Zero raw secrets present in entire log string
    expect(capturedLog).not.toContain("+919876543210");
    expect(capturedLog).not.toContain("982143");
    expect(capturedLog).not.toContain("SuperSecretPassword123!");
    expect(capturedLog).not.toContain("secret_access_token_abc_xyz");
    expect(capturedLog).not.toContain("98765432101234");
    expect(capturedLog).not.toContain("11223344556677");
    expect(capturedLog).not.toContain("student@upi");
    expect(capturedLog).not.toContain("alt_student@upi");
    expect(capturedLog).not.toContain("Bearer sensitive_jwt_token");
    expect(capturedLog).not.toContain("s_abcdef1234567890");
  });
});
