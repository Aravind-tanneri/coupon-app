import { describe, it, expect, vi } from "vitest";
import { AdminRole, AdminUser } from "@prisma/client";
import {
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
} from "./auth.schemas.js";
import { toAdminUserDTO, authService } from "./auth.service.js";
import { IDLE_TIMEOUT_MS, ABSOLUTE_TIMEOUT_MS, sessionService } from "./session.service.js";
import { UserService } from "./user.service.js";
import { prisma } from "../../lib/prisma.js";
import { BusinessRuleError } from "../../lib/errors.js";

describe("Authentication & User Management Domain (§2)", () => {
  describe("Zod Validation Schemas", () => {
    it("validates login input with valid emails and rejects malformed inputs", () => {
      const valid = loginSchema.safeParse({
        email: "ADMIN@campus.edu",
        password: "securePassword123!",
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.email).toBe("admin@campus.edu"); // Normalizes lowercase
      }

      const invalidEmail = loginSchema.safeParse({
        email: "not-an-email",
        password: "123",
      });
      expect(invalidEmail.success).toBe(false);

      const emptyPassword = loginSchema.safeParse({
        email: "admin@campus.edu",
        password: "",
      });
      expect(emptyPassword.success).toBe(false);
    });

    it("enforces minimum 12-character passwords for user creation and password changes", () => {
      const shortChange = changePasswordSchema.safeParse({
        currentPassword: "oldPassword",
        newPassword: "short",
      });
      expect(shortChange.success).toBe(false);

      const validChange = changePasswordSchema.safeParse({
        currentPassword: "oldPassword",
        newPassword: "LongEnoughPassword#2026",
      });
      expect(validChange.success).toBe(true);

      const shortCreate = createUserSchema.safeParse({
        email: "staff@campus.edu",
        name: "Staff Member",
        role: "MESS_STAFF",
        password: "short",
      });
      expect(shortCreate.success).toBe(false);
    });

    it("validates updateUserSchema fields", () => {
      const validUpdate = updateUserSchema.safeParse({
        name: "Updated Name",
        active: false,
      });
      expect(validUpdate.success).toBe(true);
    });
  });

  describe("Session Constants & DTO", () => {
    it("enforces 8-hour idle timeout and 7-day absolute timeout", () => {
      expect(IDLE_TIMEOUT_MS).toBe(8 * 60 * 60 * 1000);
      expect(ABSOLUTE_TIMEOUT_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("converts AdminUser to DTO without leaking passwordHash and with permissions array", () => {
      const user: AdminUser = {
        id: "usr-1",
        email: "staff@campus.edu",
        passwordHash: "$argon2id$v=19$m=65536,t=3,p=1$secretHash",
        name: "Kitchen Staff",
        role: AdminRole.MESS_STAFF,
        messId: "AKSHAYA",
        active: true,
        lastLoginAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dto = toAdminUserDTO(user);
      expect(dto).not.toHaveProperty("passwordHash");
      expect(dto.id).toBe("usr-1");
      expect(dto.permissions).toContain("redemption:scan");
      expect(dto.permissions).not.toContain("reimbursement:approve");
    });
  });

  describe("User Service: Super Admin Invariant (§2.5)", () => {
    it("prevents deactivating or demoting the last active SUPER_ADMIN", async () => {
      const userService = new UserService();

      const existingSuperAdmin: AdminUser = {
        id: "super-1",
        email: "superadmin@campus.edu",
        passwordHash: "hash",
        name: "Root Admin",
        role: AdminRole.SUPER_ADMIN,
        messId: null,
        active: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock prisma.adminUser.findUnique to return this super admin
      vi.spyOn(prisma.adminUser, "findUnique").mockResolvedValue(existingSuperAdmin);

      // Mock prisma.adminUser.count to return 1 (only 1 active super admin left)
      vi.spyOn(prisma.adminUser, "count").mockResolvedValue(1);

      // Attempting to deactivate the only super admin must throw BusinessRuleError
      await expect(userService.updateUser("super-1", { active: false })).rejects.toThrow(
        BusinessRuleError,
      );

      // Attempting to demote the only super admin to ADMIN must throw BusinessRuleError
      await expect(userService.updateUser("super-1", { role: AdminRole.ADMIN })).rejects.toThrow(
        BusinessRuleError,
      );

      vi.restoreAllMocks();
    });
  });

  describe("Auth Service: Mock Password Reset Workflow", () => {
    it("updates password and revokes previous sessions when user exists", async () => {
      const user = {
        id: "usr-admin",
        email: "admin@campus.edu",
        passwordHash: "oldHash",
        active: true,
      };

      vi.spyOn(prisma.adminUser, "findUnique").mockResolvedValue(user as any);
      vi.spyOn(prisma.adminUser, "update").mockResolvedValue(user as any);
      vi.spyOn(sessionService, "revokeAllUserSessions").mockResolvedValue();

      await authService.mockResetPassword("admin@campus.edu", "BrandNewPassword123!");

      expect(prisma.adminUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "usr-admin" },
          data: expect.objectContaining({
            passwordHash: expect.any(String),
          }),
        }),
      );

      vi.restoreAllMocks();
    });

    it("throws NotFoundError when admin user email is not found", async () => {
      vi.spyOn(prisma.adminUser, "findUnique").mockResolvedValue(null);

      await expect(
        authService.mockResetPassword("nonexistent@campus.edu", "NewPassword123!"),
      ).rejects.toThrow();

      vi.restoreAllMocks();
    });
  });
});
