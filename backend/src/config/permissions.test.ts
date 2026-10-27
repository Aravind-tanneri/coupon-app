import { describe, it, expect } from "vitest";
import { AdminRole } from "@prisma/client";
import { hasPermission, getPermissionsForRole, PERMISSIONS, Permission } from "./permissions.js";

describe("Permissions and RBAC Matrix (§5)", () => {
  it("SUPER_ADMIN has every defined system permission", () => {
    for (const perm of PERMISSIONS) {
      expect(hasPermission(AdminRole.SUPER_ADMIN, perm)).toBe(true);
    }
    expect(getPermissionsForRole(AdminRole.SUPER_ADMIN)).toHaveLength(PERMISSIONS.length);
  });

  it("ADMIN has operational permissions but cannot manage users, edit policy, or change system settings", () => {
    const adminPerms = [
      "menu:view",
      "menu:edit",
      "coupon:view",
      "coupon:revoke",
      "reimbursement:approve",
      "reimbursement:pay",
      "gift:issue",
      "student:import",
    ] as const;

    for (const perm of adminPerms) {
      expect(hasPermission(AdminRole.ADMIN, perm)).toBe(true);
    }

    // Forbidden for ADMIN
    expect(hasPermission(AdminRole.ADMIN, "user:manage")).toBe(false);
    expect(hasPermission(AdminRole.ADMIN, "policy:manage")).toBe(false);
    expect(hasPermission(AdminRole.ADMIN, "settings:manage")).toBe(false);
  });

  it("MESS_STAFF has only scanner and menu view permissions", () => {
    expect(hasPermission(AdminRole.MESS_STAFF, "redemption:scan")).toBe(true);
    expect(hasPermission(AdminRole.MESS_STAFF, "redemption:view")).toBe(true);
    expect(hasPermission(AdminRole.MESS_STAFF, "menu:view")).toBe(true);

    // Forbidden for MESS_STAFF
    expect(hasPermission(AdminRole.MESS_STAFF, "menu:edit")).toBe(false);
    expect(hasPermission(AdminRole.MESS_STAFF, "coupon:revoke")).toBe(false);
    expect(hasPermission(AdminRole.MESS_STAFF, "reimbursement:view")).toBe(false);
    expect(hasPermission(AdminRole.MESS_STAFF, "user:manage")).toBe(false);
  });

  it("rejects unknown permissions safely", () => {
    expect(hasPermission(AdminRole.SUPER_ADMIN, "nonexistent:action" as Permission)).toBe(false);
  });
});
