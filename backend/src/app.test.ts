import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { BusinessRuleError } from "./lib/errors.js";

describe("App Shell (/healthz and error handling)", () => {
  const app = createApp({ enableLogging: false });

  it("returns 200 OK on GET /healthz with service info and X-Request-Id", async () => {
    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("service", "campus-mess-backend");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("preserves incoming X-Request-Id header", async () => {
    const customId = "custom-req-id-12345";
    const res = await request(app).get("/healthz").set("X-Request-Id", customId);

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe(customId);
  });

  it("returns 404 with standard error envelope for unknown routes", async () => {
    const res = await request(app).get("/api/v1/non-existent-route");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toEqual({
      code: "NOT_FOUND",
      message: "Route GET /api/v1/non-existent-route not found",
      requestId: expect.any(String),
    });
  });

  it("returns 400 with INVALID_JSON error envelope when JSON payload is malformed", async () => {
    const res = await request(app)
      .post("/healthz")
      .set("Content-Type", "application/json")
      .send("{ invalid-json-payload ");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
    expect(res.body.error.requestId).toBeDefined();
  });

  it("formats AppError into the standard envelope with code and details", async () => {
    const testApp = createApp({
      enableLogging: false,
      setupRoutes: (app) => {
        app.get("/test-business-error", () => {
          throw new BusinessRuleError("MIN_DAYS_NOT_MET", "Must be away for at least 5 days", {
            countedDays: 3,
            minRequired: 5,
          });
        });
      },
    });

    const res = await request(testApp).get("/test-business-error");

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: "MIN_DAYS_NOT_MET",
      message: "Must be away for at least 5 days",
      details: {
        countedDays: 3,
        minRequired: 5,
      },
      requestId: expect.any(String),
    });
  });
});
