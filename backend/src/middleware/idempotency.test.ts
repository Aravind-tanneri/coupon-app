import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { idempotency, computeRequestHash } from "./idempotency.js";
import { prisma } from "../lib/prisma.js";
import { IdempotencyKey } from "@prisma/client";

describe("Idempotency Middleware (§3.2)", () => {
  it("computes deterministic SHA-256 hashes for request payloads", () => {
    const hash1 = computeRequestHash({ amount: 5000, date: "2026-10-10" }, {});
    const hash2 = computeRequestHash({ amount: 5000, date: "2026-10-10" }, {});
    const hashDifferent = computeRequestHash({ amount: 6000, date: "2026-10-10" }, {});

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDifferent);
    expect(hash1).toHaveLength(64);
  });

  describe("Middleware Behavior", () => {
    const app = createApp({
      enableLogging: false,
      setupRoutes: (router) => {
        router.post("/api/v1/test-mutation-idem", idempotency({ required: true }), (req, res) => {
          res.status(201).json({ created: true, data: req.body });
        });
      },
    });

    it("rejects request if required Idempotency-Key header is missing", async () => {
      const res = await request(app)
        .post("/api/v1/test-mutation-idem")
        .set("X-Requested-With", "XMLHttpRequest")
        .send({ amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toContain("Idempotency-Key");
    });

    it("replays cached response when identical key and body are resubmitted", async () => {
      const key = "test-idem-key-1";
      const body = { amountPaise: 5000 };
      const requestHash = computeRequestHash(body, {});

      vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValue({
        id: "idem-1",
        key,
        scope: "127.0.0.1",
        requestHash,
        response: {
          status: 201,
          body: { cached: true, orderId: "ORD-999" },
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      } as unknown as IdempotencyKey);

      const res = await request(app)
        .post("/api/v1/test-mutation-idem")
        .set("X-Requested-With", "XMLHttpRequest")
        .set("Idempotency-Key", key)
        .send(body);

      expect(res.status).toBe(201);
      expect(res.headers["x-cache-lookup"]).toBe("HIT-IDEMPOTENCY");
      expect(res.body).toEqual({ cached: true, orderId: "ORD-999" });

      vi.restoreAllMocks();
    });

    it("returns 422 IDEMPOTENCY_MISMATCH when same key is resubmitted with a different payload", async () => {
      const key = "test-idem-key-1";
      const originalHash = computeRequestHash({ amountPaise: 5000 }, {});
      const modifiedBody = { amountPaise: 10000 }; // Different payload!

      vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValue({
        id: "idem-1",
        key,
        scope: "127.0.0.1",
        requestHash: originalHash,
        response: {
          status: 201,
          body: { orderId: "ORD-999" },
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      } as unknown as IdempotencyKey);

      const res = await request(app)
        .post("/api/v1/test-mutation-idem")
        .set("X-Requested-With", "XMLHttpRequest")
        .set("Idempotency-Key", key)
        .send(modifiedBody);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
      expect(res.body.error.message).toContain("different request payload");

      vi.restoreAllMocks();
    });
  });
});
