import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { requirePermission } from "./permissions.js";
import { AdminRole } from "@prisma/client";

describe("requirePermission Middleware (§2.4)", () => {
  const app = createApp({
    enableLogging: false,
    setupRoutes: (router) => {
      // Mock test route with user injected before check
      router.get(
        "/test-approve",
        (req, _res, next) => {
          const roleHeader = req.headers["x-test-role"] as AdminRole | undefined;
          if (roleHeader) {
            req.adminUser = {
              id: "user-1",
              email: "test@campus.edu",
              name: "Test User",
              role: roleHeader,
              messId: "AKSHAYA",
            };
          }
          next();
        },
        requirePermission("reimbursement:approve"),
        (_req, res) => res.json({ approved: true }),
      );
    },
  });

  it("returns 401 Unauthorized if no adminUser is attached to request", async () => {
    const res = await request(app).get("/test-approve");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 Forbidden if user role lacks permission (MESS_STAFF)", async () => {
    const res = await request(app).get("/test-approve").set("x-test-role", "MESS_STAFF");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toContain("reimbursement:approve");
  });

  it("allows access if user role possesses permission (ADMIN)", async () => {
    const res = await request(app).get("/test-approve").set("x-test-role", "ADMIN");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ approved: true });
  });

  it("allows access if user role is SUPER_ADMIN", async () => {
    const res = await request(app).get("/test-approve").set("x-test-role", "SUPER_ADMIN");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ approved: true });
  });
});
