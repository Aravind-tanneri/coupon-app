import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";

export interface LogAuditParams {
  actorType: "ADMIN" | "STUDENT" | "SYSTEM";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
}

const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "tokenhash",
  "otp",
  "codehash",
  "secret",
  "encryptedpayout",
  "payoutdetails",
]);

/**
 * Recursively strips sensitive secrets and payout details before logging to audit.
 */
export function sanitizeAuditData(data: unknown): Prisma.InputJsonValue | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }

  if (typeof data !== "object") {
    return data as Prisma.InputJsonValue;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item)) as Prisma.InputJsonValue;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (REDACT_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as Prisma.InputJsonValue;
}

export class AuditService {
  /**
   * Records an immutable entry into AuditLog.
   * Can run within an existing Prisma transaction or standalone.
   */
  async log(params: LogAuditParams, tx?: Prisma.TransactionClient | PrismaClient): Promise<void> {
    const client = tx ?? defaultPrisma;

    const beforeClean = sanitizeAuditData(params.before);
    const afterClean = sanitizeAuditData(params.after);

    await client.auditLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: beforeClean,
        after: afterClean,
        ip: params.ip ?? null,
      },
    });
  }

  /**
   * Retrieves paginated audit logs with optional filters.
   */
  async listLogs(params: {
    entityType?: string;
    entityId?: string;
    actorId?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {
      ...(params.entityType && { entityType: params.entityType }),
      ...(params.entityId && { entityId: params.entityId }),
      ...(params.actorId && { actorId: params.actorId }),
      ...(params.action && { action: params.action }),
    };

    const [logs, total] = await Promise.all([
      defaultPrisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { at: "desc" },
      }),
      defaultPrisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      pageSize,
    };
  }
}

export const auditService = new AuditService();
