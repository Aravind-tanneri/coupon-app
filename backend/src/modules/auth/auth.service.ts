import { AdminRole, AdminUser } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { sessionService } from "./session.service.js";
import { loginRateLimiter } from "../../middleware/rateLimit.js";
import { getPermissionsForRole, Permission } from "../../config/permissions.js";
import { UnauthorizedError, ValidationError, NotFoundError } from "../../lib/errors.js";
import { LoginInput, ChangePasswordInput } from "./auth.schemas.js";

export interface AdminUserDTO {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  messId: string | null;
  permissions: Permission[];
}

export function toAdminUserDTO(user: AdminUser): AdminUserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    messId: user.messId,
    permissions: getPermissionsForRole(user.role),
  };
}

export class AuthService {
  /**
   * Authenticates admin with email + password, protected by lockout rate limiter.
   */
  async login(
    input: LoginInput,
    ip: string,
    ua?: string,
  ): Promise<{ user: AdminUserDTO; sessionToken: string }> {
    const { isLocked } = loginRateLimiter.check(ip, input.email);
    if (isLocked) {
      throw new UnauthorizedError(
        "Account temporarily locked due to repeated failed login attempts. Please try again later.",
      );
    }

    const user = await prisma.adminUser.findUnique({
      where: { email: input.email },
    });

    if (!user || !user.active) {
      loginRateLimiter.recordFailure(ip, input.email);
      throw new UnauthorizedError("Invalid email or password");
    }

    const isMatch = await verifyPassword(input.password, user.passwordHash);
    if (!isMatch) {
      loginRateLimiter.recordFailure(ip, input.email);
      throw new UnauthorizedError("Invalid email or password");
    }

    // Login successful: reset rate limiter failures
    loginRateLimiter.reset(ip, input.email);

    // Update lastLoginAt
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Create session
    const { sessionToken } = await sessionService.createSession(user.id, ip, ua);

    return {
      user: toAdminUserDTO(user),
      sessionToken,
    };
  }

  /**
   * Logs out admin by revoking the current session.
   */
  async logout(sessionToken: string): Promise<void> {
    await sessionService.revokeSession(sessionToken);
  }

  /**
   * Returns current admin profile with assigned permissions.
   */
  async getMe(userId: string): Promise<AdminUserDTO> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new NotFoundError("Admin user not found or deactivated");
    }

    return toAdminUserDTO(user);
  }

  /**
   * Changes admin password and revokes all other active sessions for security.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    ip?: string,
    ua?: string,
  ): Promise<{ sessionToken: string }> {
    const user = await prisma.adminUser.findUnique({
      where: { id: userId },
    });

    if (!user || !user.active) {
      throw new NotFoundError("Admin user not found");
    }

    const isMatch = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new ValidationError("Current password does not match");
    }

    if (input.currentPassword === input.newPassword) {
      throw new ValidationError("New password cannot be identical to current password");
    }

    const newHash = await hashPassword(input.newPassword);

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Revoke all existing sessions for this user across all devices
    await sessionService.revokeAllUserSessions(user.id);

    // Issue a clean new session for the current client
    const { sessionToken } = await sessionService.createSession(user.id, ip, ua);

    return { sessionToken };
  }

  /**
   * Mock/demo password reset workflow: updates user's password in demo mode.
   */
  async mockResetPassword(email: string, newPassword: string): Promise<void> {
    const user = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      throw new NotFoundError("Admin user not found with this email");
    }

    const newHash = await hashPassword(newPassword);

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Revoke previous sessions
    await sessionService.revokeAllUserSessions(user.id);
  }
}

export const authService = new AuthService();
