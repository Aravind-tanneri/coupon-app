import { describe, it, expect } from "vitest";
import { getMessContext, assertMessScope, StudentActor, AdminActor } from "./mess-context.js";
import { ForbiddenError } from "./errors.js";

describe("Mess Context Helper", () => {
  const student: StudentActor = {
    type: "STUDENT",
    studentId: "student-1",
    messId: "AKSHAYA",
  };

  const admin: AdminActor = {
    type: "ADMIN_USER",
    userId: "admin-1",
    role: "ADMIN",
    messId: "AKSHAYA",
  };

  const superAdmin: AdminActor = {
    type: "ADMIN_USER",
    userId: "superadmin-1",
    role: "SUPER_ADMIN",
    messId: null,
  };

  it("resolves student context strictly to their assigned mess", () => {
    const ctx = getMessContext(student);
    expect(ctx.messId).toBe("AKSHAYA");
    expect(ctx.isSuperAdmin).toBe(false);

    // Student requesting their own mess is allowed
    expect(getMessContext(student, "AKSHAYA").messId).toBe("AKSHAYA");

    // Student requesting a different mess throws ForbiddenError
    expect(() => getMessContext(student, "AMRUTHA")).toThrow(ForbiddenError);
  });

  it("resolves regular admin context restricted to assigned mess", () => {
    const ctx = getMessContext(admin);
    expect(ctx.messId).toBe("AKSHAYA");
    expect(ctx.isSuperAdmin).toBe(false);

    // Admin requesting another mess throws ForbiddenError
    expect(() => getMessContext(admin, "AMRUTHA")).toThrow(ForbiddenError);
  });

  it("allows super admin to query any requested mess", () => {
    const ctxDefault = getMessContext(superAdmin);
    expect(ctxDefault.messId).toBe("AKSHAYA"); // Fallback to DEFAULT_MESS_CODE
    expect(ctxDefault.isSuperAdmin).toBe(true);

    const ctxAmrutha = getMessContext(superAdmin, "AMRUTHA");
    expect(ctxAmrutha.messId).toBe("AMRUTHA");
    expect(ctxAmrutha.isSuperAdmin).toBe(true);
  });

  it("assertMessScope verifies entity matches active context", () => {
    expect(() => assertMessScope("AKSHAYA", "AKSHAYA")).not.toThrow();
    expect(() => assertMessScope("AKSHAYA", "AMRUTHA")).toThrow(ForbiddenError);
  });
});
