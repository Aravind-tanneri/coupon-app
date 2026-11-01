import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

describe("CSRF and CORS Protection Middleware (§2.2)", () => {
  const app = createApp({
    enableLogging: false,
    setupRoutes: (router) => {
      router.get("/api/v1/test-resource", (_req, res) => res.json({ ok: true }));
      router.post("/api/v1/test-mutation", (_req, res) => res.json({ updated: true }));
      router.post("/api/v1/payments/razorpay/webhook", (_req, res) => res.json({ webhook: true }));
    },
  });

  it("allows safe GET requests without CSRF headers", async () => {
    const res = await request(app).get("/api/v1/test-resource");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects mutating POST requests without X-Requested-With header (403 Forbidden)", async () => {
    const res = await request(app).post("/api/v1/test-mutation").send({ data: 123 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toContain("X-Requested-With");
  });

  it("rejects mutating requests with untrusted Origin", async () => {
    const res = await request(app)
      .post("/api/v1/test-mutation")
      .set("X-Requested-With", "XMLHttpRequest")
      .set("Origin", "https://malicious-attacker.com")
      .send({ data: 123 });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain("Untrusted Origin");
  });

  it("accepts mutating requests with valid X-Requested-With and matching Origin", async () => {
    const res = await request(app)
      .post("/api/v1/test-mutation")
      .set("X-Requested-With", "XMLHttpRequest")
      .set("Origin", "http://localhost:5173")
      .send({ data: 123 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
  });

  it("exempts webhook endpoints from CSRF header requirement", async () => {
    const res = await request(app)
      .post("/api/v1/payments/razorpay/webhook")
      .send({ event: "order.paid" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ webhook: true });
  });

  it("handles CORS preflight OPTIONS request from Vercel deployment", async () => {
    const res = await request(app)
      .options("/api/v1/test-mutation")
      .set("Origin", "https://coupon-app-gdsc.vercel.app")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type,X-Requested-With");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://coupon-app-gdsc.vercel.app");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("accepts mutating requests from Vercel deployment with valid CSRF header", async () => {
    const res = await request(app)
      .post("/api/v1/test-mutation")
      .set("Origin", "https://coupon-app-gdsc.vercel.app")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ data: 123 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    expect(res.headers["access-control-allow-origin"]).toBe("https://coupon-app-gdsc.vercel.app");
  });
});
