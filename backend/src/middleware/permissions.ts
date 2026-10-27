import { Request, Response, NextFunction } from "express";
import { Permission, hasPermission } from "../config/permissions.js";
import { UnauthorizedError, ForbiddenError } from "../lib/errors.js";

/**
 * Middleware ensuring the authenticated admin possesses the required system permission.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const adminUser = req.adminUser;

    if (!adminUser) {
      return next(new UnauthorizedError("Authentication required"));
    }

    if (!hasPermission(adminUser.role, permission)) {
      return next(
        new ForbiddenError(
          `Forbidden: Insufficient privileges to perform action requiring [${permission}]`,
        ),
      );
    }

    next();
  };
}
