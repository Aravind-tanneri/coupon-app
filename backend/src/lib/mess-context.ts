import { env } from "../config/env.js";
import { ForbiddenError } from "./errors.js";

export interface StudentActor {
  type: "STUDENT";
  studentId: string;
  messId: string;
}

export interface AdminActor {
  type: "ADMIN_USER";
  userId: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MESS_STAFF";
  messId: string | null;
}

export type ActorContext = StudentActor | AdminActor;

export interface MessContext {
  messId: string;
  isSuperAdmin: boolean;
}

/**
 * Resolves the active messId for any authenticated actor.
 * Enforces strict mess boundary isolation.
 */
export function getMessContext(actor: ActorContext, requestedMessId?: string): MessContext {
  if (actor.type === "STUDENT") {
    if (requestedMessId && requestedMessId !== actor.messId) {
      throw new ForbiddenError("Students cannot access or query across different mess facilities");
    }
    return {
      messId: actor.messId,
      isSuperAdmin: false,
    };
  }

  // Admin user
  const isSuperAdmin = actor.role === "SUPER_ADMIN";

  if (isSuperAdmin) {
    const resolvedMessId = requestedMessId ?? actor.messId ?? env.DEFAULT_MESS_CODE;
    return {
      messId: resolvedMessId,
      isSuperAdmin: true,
    };
  }

  // Regular ADMIN or MESS_STAFF
  const assignedMessId = actor.messId ?? env.DEFAULT_MESS_CODE;
  if (requestedMessId && requestedMessId !== assignedMessId) {
    throw new ForbiddenError("Admin is restricted to their assigned mess facility");
  }

  return {
    messId: assignedMessId,
    isSuperAdmin: false,
  };
}

/**
 * Asserts that an entity's messId matches the active execution context.
 */
export function assertMessScope(entityMessId: string, contextMessId: string): void {
  if (entityMessId !== contextMessId) {
    throw new ForbiddenError(
      `Cross-mess boundary violation: Entity belongs to mess [${entityMessId}], but active context is [${contextMessId}]`,
    );
  }
}
