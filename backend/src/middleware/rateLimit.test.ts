import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { LoginRateLimiter, checkLoginRateLimit } from "./rateLimit.js";
import { createApp } from "../app.js";

describe("Login Rate Limiter and Lockout Protection (§2.3)", () => {
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter({
      maxAttempts: 5,
      windowMs: 60 * 1000,
      lockoutMs: 60 * 1000,
    });
  });

  it("permits initial 5 failed attempts", () => {
    const ip = "192.168.1.10";
    const email = "admin@campus.edu";

    for (let i = 0; i < 5; i++) {
      expect(limiter.check(ip, email).isLocked).toBe(false);
      limiter.recordFailure(ip, email);
    }
  });

  it("locks out user on the 6th failed attempt", () => {
    const ip = "192.168.1.10";
    const email = "admin@campus.edu";

    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(ip, email);
    }

    const check = limiter.check(ip, email);
    expect(check.isLocked).toBe(true);
    expect(check.remainingMs).toBeGreaterThan(0);
  });

  it("resets failure counter upon successful login", () => {
    const ip = "192.168.1.10";
    const email = "admin@campus.edu";

    limiter.recordFailure(ip, email);
    limiter.recordFailure(ip, email);
    limiter.reset(ip, email);

    expect(limiter.check(ip, email).isLocked).toBe(false);
  });

  it("middleware returns 429 when locked out", async () => {
    const testLimiter = new LoginRateLimiter({ maxAttempts: 2 });
    const ip = "127.0.0.1";
    const email = "locked@campus.edu";

    testLimiter.recordFailure(ip, email);
    testLimiter.recordFailure(ip, email);

    const app = createApp({
      enableLogging: false,
      setupRoutes: (router) => {
        router.post("/test-login-limit", checkLoginRateLimit(testLimiter), (_req, res) =>
          res.json({ success: true }),
        );
      },
    });

    const res = await request(app)
      .post("/test-login-limit")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ email });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(res.body.error.message).toContain("Account temporarily locked");
  });
});
