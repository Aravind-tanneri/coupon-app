import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import { createApp } from "../../app.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    coupon: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

describe("Phase 25 / §25.9 Automated Smoke Test Verification", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ enableLogging: false });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          port = address.port;
          baseUrl = `http://127.0.0.1:${port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("Probe 1: Healthcheck returns 200 OK with correct service payload", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
    expect(data.service).toBe("campus-mess-backend");
    expect(data.timestamp).toBeDefined();
  });

  it("Probe 2: Security headers (Helmet nosniff) are present on perimeter", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("Probe 3: Public pass route enforces Cache-Control: no-store and Referrer-Policy: no-referrer", async () => {
    const res = await fetch(`${baseUrl}/c/SMOKE_TEST_UNKNOWN_TOKEN`);
    expect(res.status).toBe(404);

    const cacheControl = res.headers.get("cache-control") || "";
    expect(cacheControl).toContain("no-store");

    const referrerPolicy = res.headers.get("referrer-policy") || "";
    expect(referrerPolicy).toBe("no-referrer");

    const data = (await res.json()) as any;
    expect(data.error.code).toBe("NOT_FOUND");
    expect(data).not.toHaveProperty("stack");
  });

  it("Probe 4: Undefined API routes return uniform 404 envelope", async () => {
    const res = await fetch(`${baseUrl}/api/v1/smoke-unknown-path`);
    expect(res.status).toBe(404);

    const data = (await res.json()) as any;
    expect(data.error.code).toBe("NOT_FOUND");
    expect(data.error.message).toContain("not found");
  });

  it("Probe 5: Unauthenticated requests to admin routes are rejected with 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/reimbursements/requests`);
    expect(res.status).toBe(401);

    const data = (await res.json()) as any;
    expect(data.error.code).toBe("UNAUTHORIZED");
  });
});
