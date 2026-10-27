import "express";
import { AdminRole } from "@prisma/client";

export interface AdminUserContext {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  messId: string | null;
}

export interface SessionContext {
  id: string;
  tokenHash: string;
  expiresAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      id?: string;
      rawBody?: Buffer;
      adminUser?: AdminUserContext;
      session?: SessionContext;
    }
  }
}

export {};
