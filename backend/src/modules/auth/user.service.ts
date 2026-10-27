import { AdminRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/crypto.js";
import { sessionService } from "./session.service.js";
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from "../../lib/errors.js";
import { CreateUserInput, UpdateUserInput } from "./auth.schemas.js";
import { AdminUserDTO, toAdminUserDTO } from "./auth.service.js";

export class UserService {
  /**
   * Lists all admin staff accounts with pagination.
   */
  async listUsers(
    page = 1,
    pageSize = 20,
  ): Promise<{ users: AdminUserDTO[]; total: number; page: number; pageSize: number }> {
    const skip = (page - 1) * pageSize;

    const [users, total] = await Promise.all([
      prisma.adminUser.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.adminUser.count(),
    ]);

    return {
      users: users.map(toAdminUserDTO),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Creates a new admin staff account.
   */
  async createUser(input: CreateUserInput): Promise<AdminUserDTO> {
    const existing = await prisma.adminUser.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      throw new ConflictError("An account with this email address already exists");
    }

    // If messId is provided, verify it exists
    if (input.messId) {
      const mess = await prisma.mess.findUnique({
        where: { id: input.messId },
      });
      if (!mess) {
        throw new ValidationError(`Mess with id [${input.messId}] not found`);
      }
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.adminUser.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        role: input.role,
        messId: input.messId || null,
        active: true,
      },
    });

    return toAdminUserDTO(user);
  }

  /**
   * Updates an admin account.
   * Guarantees the last remaining active SUPER_ADMIN cannot be deactivated or demoted.
   */
  async updateUser(id: string, input: UpdateUserInput): Promise<AdminUserDTO> {
    const user = await prisma.adminUser.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundError("Admin user not found");
    }

    // Safety guard: Protect the last active SUPER_ADMIN
    const isDemotion =
      input.role && input.role !== AdminRole.SUPER_ADMIN && user.role === AdminRole.SUPER_ADMIN;
    const isDeactivation =
      input.active === false && user.role === AdminRole.SUPER_ADMIN && user.active;

    if (isDemotion || isDeactivation) {
      const activeSuperAdminCount = await prisma.adminUser.count({
        where: { role: AdminRole.SUPER_ADMIN, active: true },
      });

      if (activeSuperAdminCount <= 1) {
        throw new BusinessRuleError(
          "LAST_SUPER_ADMIN",
          "Cannot deactivate or demote the last remaining Super Admin in the system",
        );
      }
    }

    // If messId is changing, verify target mess exists
    if (input.messId) {
      const mess = await prisma.mess.findUnique({
        where: { id: input.messId },
      });
      if (!mess) {
        throw new ValidationError(`Mess with id [${input.messId}] not found`);
      }
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.messId !== undefined && { messId: input.messId }),
        ...(input.active !== undefined && { active: input.active }),
      },
    });

    // If deactivated, revoke all their active sessions immediately
    if (input.active === false) {
      await sessionService.revokeAllUserSessions(id);
    }

    return toAdminUserDTO(updated);
  }
}

export const userService = new UserService();
