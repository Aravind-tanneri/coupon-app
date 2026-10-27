import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super(429, "TOO_MANY_REQUESTS", message);
  }
}

interface AttemptRecord {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

export class LoginRateLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;

  constructor(options: { maxAttempts?: number; windowMs?: number; lockoutMs?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000; // 15 minutes
    this.lockoutMs = options.lockoutMs ?? 15 * 60 * 1000; // 15 minutes
  }

  private getKey(ip: string, email: string): string {
    return `${ip}:${email.trim().toLowerCase()}`;
  }

  public check(ip: string, email: string): { isLocked: boolean; remainingMs?: number } {
    const key = this.getKey(ip, email);
    const record = this.attempts.get(key);
    const now = Date.now();

    if (!record) {
      return { isLocked: false };
    }

    // Check if lockout is active
    if (record.lockedUntil) {
      if (now < record.lockedUntil) {
        return { isLocked: true, remainingMs: record.lockedUntil - now };
      }
      // Lockout expired, reset
      this.attempts.delete(key);
      return { isLocked: false };
    }

    // Check if window expired
    if (now - record.firstAttemptAt > this.windowMs) {
      this.attempts.delete(key);
      return { isLocked: false };
    }

    if (record.count >= this.maxAttempts) {
      record.lockedUntil = now + this.lockoutMs;
      return { isLocked: true, remainingMs: this.lockoutMs };
    }

    return { isLocked: false };
  }

  public recordFailure(ip: string, email: string): void {
    const key = this.getKey(ip, email);
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || now - record.firstAttemptAt > this.windowMs) {
      this.attempts.set(key, {
        count: 1,
        firstAttemptAt: now,
        lockedUntil: null,
      });
      return;
    }

    record.count += 1;
    if (record.count >= this.maxAttempts) {
      record.lockedUntil = now + this.lockoutMs;
    }
  }

  public reset(ip: string, email: string): void {
    const key = this.getKey(ip, email);
    this.attempts.delete(key);
  }

  public clearAll(): void {
    this.attempts.clear();
  }
}

export const loginRateLimiter = new LoginRateLimiter();

/**
 * Express middleware checking login brute-force status before processing authentication.
 */
export function checkLoginRateLimit(limiter: LoginRateLimiter = loginRateLimiter) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const email = typeof req.body?.email === "string" ? req.body.email : "";

    if (!email) {
      return next();
    }

    const { isLocked, remainingMs } = limiter.check(ip, email);
    if (isLocked) {
      const waitMinutes = Math.ceil((remainingMs || 0) / (60 * 1000));
      return next(
        new TooManyRequestsError(
          `Account temporarily locked due to too many failed login attempts. Please try again after ${waitMinutes} minute(s).`,
        ),
      );
    }

    next();
  };
}
