import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { ForbiddenError } from "../lib/errors.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Webhook endpoints verified by cryptographic signatures, not browser sessions
const WEBHOOK_PATHS = [
  "/api/v1/payments/razorpay/webhook",
  "/api/v1/whatsapp/webhook",
  "/whatsapp/webhook",
  "/api/v1/notifications/email/webhook",
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

  const checkOrigin = (candidate?: string): boolean => {
    if (!candidate) return true;
    try {
      const parsed = new URL(candidate).origin;
      const allowedOrigin = new URL(env.FRONTEND_URL).origin;
      if (parsed === allowedOrigin || parsed === `http://localhost:${env.PORT}`) {
        return true;
      }
      const hostname = new URL(candidate).hostname;
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".vercel.app") ||
        hostname.endsWith(".onrender.com") ||
        process.env.DISABLE_CORS === "true" ||
        process.env.DISABLE_CSRF === "true"
      ) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  if (origin && !checkOrigin(origin)) {
    return next(new ForbiddenError(`CSRF protection: Untrusted Origin [${origin}]`));
  }

  if (referer && !checkOrigin(referer)) {
    return next(new ForbiddenError(`CSRF protection: Untrusted Referer [${referer}]`));
  }

  next();
}
