import { AdminRole } from "@prisma/client";

export const PERMISSIONS = [
  // Menu
  "menu:view",
  "menu:edit",

  // Coupons
  "coupon:view",
  "coupon:revoke",
  "coupon:product:manage",

  // Redemptions
  "redemption:scan",
  "redemption:view",

  // Feedback
  "feedback:view",
  "feedback:manage",

  // Announcements
  "announcement:view",
  "announcement:manage",

  // Reimbursements
  "reimbursement:view",
  "reimbursement:review",
  "reimbursement:approve",
  "reimbursement:reject",
  "reimbursement:pay",

  // Reimbursement Policy (SUPER_ADMIN)
  "policy:view",
  "policy:manage",

  // Gifts
  "gift:view",
  "gift:issue",
  "gift:revoke",
  "gift:resend",

  // Students & Roster
  "student:view",
  "student:import",
  "student:reset_whatsapp",

  // User Management (SUPER_ADMIN)
  "user:manage",

  // Audit
  "audit:view",

  // Settings (SUPER_ADMIN)
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set<Permission>(PERMISSIONS),

  ADMIN: new Set<Permission>([
    "menu:view",
    "menu:edit",
    "coupon:view",
    "coupon:revoke",
    "coupon:product:manage",
    "redemption:scan",
    "redemption:view",
    "feedback:view",
    "feedback:manage",
    "announcement:view",
    "announcement:manage",
    "reimbursement:view",
    "reimbursement:review",
    "reimbursement:approve",
    "reimbursement:reject",
    "reimbursement:pay",
    "policy:view",
    "gift:view",
    "gift:issue",
    "gift:revoke",
    "gift:resend",
    "student:view",
    "student:import",
    "student:reset_whatsapp",
    "audit:view",
  ]),

  MESS_STAFF: new Set<Permission>(["menu:view", "redemption:scan", "redemption:view"]),
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  const roleSet = ROLE_PERMISSIONS[role];
  return roleSet ? roleSet.has(permission) : false;
}

export function getPermissionsForRole(role: AdminRole): Permission[] {
  const roleSet = ROLE_PERMISSIONS[role];
  return roleSet ? Array.from(roleSet) : [];
}
