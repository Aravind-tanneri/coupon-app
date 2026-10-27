import { describe, it, expect, vi } from "vitest";
import { sanitizeAuditData, AuditService } from "./audit.service.js";
import { prisma } from "../../lib/prisma.js";
import { AuditLog } from "@prisma/client";

interface SanitizedUserData {
  action: string;
  password: string;
  passwordHash: string;
  token: string;
  encryptedPayout: string;
  student: {
    name: string;
    payoutDetails: string;
    safeMeta: {
      department: string;
    };
  };
}

describe("Audit Service (§3.1)", () => {
  it("sanitizes passwords, tokens, secrets, and payout details recursively", () => {
    const rawData = {
      action: "UPDATE_PROFILE",
      password: "secretPassword",
      passwordHash: "hashValue",
      token: "secretToken",
      encryptedPayout: "iv:tag:data",
      student: {
        name: "Aarav",
        rollNo: "2024CS001",
        payoutDetails: "bank_account_number",
        safeMeta: {
          department: "CSE",
        },
      },
      tags: ["student", "update"],
    };

    const sanitized = sanitizeAuditData(rawData) as unknown as SanitizedUserData;

    expect(sanitized.action).toBe("UPDATE_PROFILE");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.passwordHash).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.encryptedPayout).toBe("[REDACTED]");
    expect(sanitized.student.name).toBe("Aarav");
    expect(sanitized.student.payoutDetails).toBe("[REDACTED]");
    expect(sanitized.student.safeMeta.department).toBe("CSE");
  });

  it("handles primitives, null, and undefined gracefully", () => {
    expect(sanitizeAuditData(null)).toBeUndefined();
    expect(sanitizeAuditData(undefined)).toBeUndefined();
    expect(sanitizeAuditData(123)).toBe(123);
    expect(sanitizeAuditData("simple")).toBe("simple");
  });

  it("logs immutable audit entry through Prisma client", async () => {
    const auditService = new AuditService();
    const createSpy = vi.spyOn(prisma.auditLog, "create").mockResolvedValue({
      id: "audit-1",
      actorType: "ADMIN",
      actorId: "admin-1",
      action: "REIMBURSEMENT_APPROVED",
      entityType: "ReimbursementRequest",
      entityId: "reimb-123",
      before: null,
      after: { status: "APPROVED" },
      ip: "127.0.0.1",
      at: new Date(),
    } as unknown as AuditLog);

    await auditService.log({
      actorType: "ADMIN",
      actorId: "admin-1",
      action: "REIMBURSEMENT_APPROVED",
      entityType: "ReimbursementRequest",
      entityId: "reimb-123",
      after: { status: "APPROVED", token: "secretToken" },
      ip: "127.0.0.1",
    });

    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "REIMBURSEMENT_APPROVED",
        entityType: "ReimbursementRequest",
        entityId: "reimb-123",
        after: { status: "APPROVED", token: "[REDACTED]" },
        ip: "127.0.0.1",
      }),
    });

    createSpy.mockRestore();
  });
});
