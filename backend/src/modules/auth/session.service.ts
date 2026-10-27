import { Session, AdminUser } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { generateToken, hashToken } from "../../lib/tokens.js";

export const SESSION_COOKIE_NAME = "campus_session";
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CreateSessionResult {
  sessionToken: string;
  session: Session;
}

export class SessionService {
  /**
   * Creates a new server-side session in PostgreSQL.
   * Generates a 256-bit CSPRNG token; stores ONLY the SHA-256 hash.
   */
  async createSession(adminUserId: string, ip?: string, ua?: string): Promise<CreateSessionResult> {
    const rawToken = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + IDLE_TIMEOUT_MS);

    const session = await prisma.session.create({
      data: {
        adminUserId,
        tokenHash,
        expiresAt,
        ip,
        ua,
      },
    });

    return { sessionToken: rawToken, session };
  }

  /**
   * Validates a session token, checking idle and absolute expiry.
   * Returns the attached AdminUser if valid.
   */
  async validateSession(rawToken: string): Promise<{ session: Session; user: AdminUser } | null> {
    const tokenHash = hashToken(rawToken);

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { adminUser: true },
    });

    if (!session) {
      return null;
    }

    const now = Date.now();

    // 1. Check absolute timeout (7 days from creation)
    if (now - session.createdAt.getTime() > ABSOLUTE_TIMEOUT_MS) {
      await this.revokeSession(rawToken);
      return null;
    }

    // 2. Check idle timeout
    if (session.expiresAt.getTime() < now) {
      await this.revokeSession(rawToken);
      return null;
    }

    // 3. Check user is active
    if (!session.adminUser.active) {
      await this.revokeSession(rawToken);
      return null;
    }

    // 4. Slide idle window forward (update if more than 15 minutes elapsed since last extension)
    const newExpiresAt = new Date(now + IDLE_TIMEOUT_MS);
    if (newExpiresAt.getTime() - session.expiresAt.getTime() > 15 * 60 * 1000) {
      await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: newExpiresAt },
      });
    }

    return { session, user: session.adminUser };
  }

  /**
   * Revokes a single session by token (e.g. user logout).
   */
  async revokeSession(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    try {
      await prisma.session.delete({
        where: { tokenHash },
      });
    } catch {
      // Session already deleted or expired
    }
  }

  /**
   * Revokes all active sessions for a user (e.g. password change).
   * Optionally keeps a specific session active.
   */
  async revokeAllUserSessions(adminUserId: string, exceptTokenHash?: string): Promise<void> {
    if (exceptTokenHash) {
      await prisma.session.deleteMany({
        where: {
          adminUserId,
          tokenHash: { not: exceptTokenHash },
        },
      });
    } else {
      await prisma.session.deleteMany({
        where: { adminUserId },
      });
    }
  }
}

export const sessionService = new SessionService();
