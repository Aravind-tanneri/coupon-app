import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { ForbiddenError } from "../lib/errors.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Webhook endpoints verified by cryptographic signatures, not browser sessions
const WEBHOOK_PATHS = [
  "/api/v1/payments/razorpay/webhook",
  "/api/v1/whatsapp/webhook",
  "/whatsapp/webhook",
  "/notifications/email/webhook",
];

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  // Safe HTTP methods do not mutate state
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  // Exempt signature-verified public webhooks
  if (WEBHOOK_PATHS.some((path) => req.path.startsWith(path))) {
    return next();
  }

  // 1. Verify required custom header (X-Requested-With)
  const requestedWith = req.headers["x-requested-with"];
  if (!requestedWith) {
    return next(new ForbiddenError("CSRF protection: Missing required 'X-Requested-With' header"));
  }

  // 2. Verify Origin / Referer against allowed frontend URL
  const origin = req.headers["origin"];
  const referer = req.headers["referer"];

  if (origin) {
    const allowedOrigin = new URL(env.FRONTEND_URL).origin;
    if (origin !== allowedOrigin && origin !== `http://localhost:${env.PORT}`) {
      return next(new ForbiddenError(`CSRF protection: Untrusted Origin [${origin}]`));
    }
  } else if (referer) {
    const allowedOrigin = new URL(env.FRONTEND_URL).origin;
    try {
      const refererOrigin = new URL(referer).origin;
      if (refererOrigin !== allowedOrigin && refererOrigin !== `http://localhost:${env.PORT}`) {
        return next(new ForbiddenError(`CSRF protection: Untrusted Referer [${referer}]`));
      }
    } catch {
      return next(new ForbiddenError("CSRF protection: Malformed Referer header"));
    }
  }

  next();
}
