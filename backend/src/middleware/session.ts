import { Request, Response, NextFunction } from "express";
import { sessionService, SESSION_COOKIE_NAME } from "../modules/auth/session.service.js";
import { UnauthorizedError } from "../lib/errors.js";

/**
 * Extracts session token from HTTP-only cookie or Authorization header.
 */
export function extractSessionToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.trim().length > 0) {
    return cookieToken.trim();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken.length > 0) {
      return bearerToken;
    }
  }

  return null;
}

/**
 * Middleware that populates req.adminUser and req.session if a valid session exists.
 * Does NOT throw if unauthenticated (allows optional auth / public routes).
 */
export async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractSessionToken(req);
  if (!token) {
    return next();
  }

  try {
    const result = await sessionService.validateSession(token);
    if (result) {
      req.adminUser = {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        messId: result.user.messId,
      };
      req.session = {
        id: result.session.id,
        tokenHash: result.session.tokenHash,
        expiresAt: result.session.expiresAt,
      };
    }
  } catch {
    // Session validation error - log and proceed unauthenticated
    // (Actual auth gates will throw UnauthorizedError)
  }

  next();
}

/**
 * Middleware strictly requiring an authenticated admin session.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.adminUser || !req.session) {
    return next(new UnauthorizedError("Authentication required: Please log in"));
  }
  next();
}
