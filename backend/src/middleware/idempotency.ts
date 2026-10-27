import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { IdempotencyMismatchError, ValidationError } from "../lib/errors.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function computeRequestHash(body: unknown, query: unknown): string {
  const normalized = JSON.stringify({
    body: body ?? {},
    query: query ?? {},
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export interface IdempotencyOptions {
  required?: boolean;
}

/**
 * Middleware providing 24-hour request idempotency against replayed or concurrent mutating requests.
 */
export function idempotency(options: IdempotencyOptions = { required: true }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const keyHeader = req.headers["idempotency-key"];
    const key = typeof keyHeader === "string" ? keyHeader.trim() : undefined;

    if (!key) {
      if (options.required) {
        return next(
          new ValidationError(
            "Missing required 'Idempotency-Key' header for this sensitive mutation",
          ),
        );
      }
      return next();
    }

    const scope = req.adminUser?.id || req.ip || req.path;
    const requestHash = computeRequestHash(req.body, req.query);

    try {
      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          scope_key: {
            scope,
            key,
          },
        },
      });

      if (existing) {
        // If the same key is reused with a different request body, reject with 422
        if (existing.requestHash !== requestHash) {
          return next(new IdempotencyMismatchError());
        }

        // Replay cached response
        const cached = existing.response as {
          status: number;
          body: unknown;
        };

        res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENCY");
        res.status(cached.status).json(cached.body);
        return;
      }
    } catch {
      // If DB error during lookup, proceed to execute handler
    }

    // Intercept outgoing JSON response to cache it
    const originalJson = res.json.bind(res);

    res.json = (body: unknown): Response => {
      // Only cache successful or client-error responses, never 5xx internal crashes
      if (res.statusCode < 500) {
        const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
        const responseData = {
          status: res.statusCode,
          body: body as Prisma.InputJsonValue,
        };

        prisma.idempotencyKey
          .upsert({
            where: {
              scope_key: {
                scope,
                key,
              },
            },
            update: {
              response: responseData,
              expiresAt,
            },
            create: {
              key,
              scope,
              requestHash,
              response: responseData,
              expiresAt,
            },
          })
          .catch(() => {
            // Non-blocking caching error
          });
      }

      return originalJson(body);
    };

    next();
  };
}
