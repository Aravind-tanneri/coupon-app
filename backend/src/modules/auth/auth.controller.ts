import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service.js";
import { loginSchema, changePasswordSchema } from "./auth.schemas.js";
import { SESSION_COOKIE_NAME, ABSOLUTE_TIMEOUT_MS } from "./session.service.js";
import { extractSessionToken } from "../../middleware/session.js";
import { env } from "../../config/env.js";
import { UnauthorizedError, ValidationError } from "../../lib/errors.js";

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: ABSOLUTE_TIMEOUT_MS,
};

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const ua = req.headers["user-agent"];

    const { user, sessionToken } = await authService.login(input, ip, ua);

    res.cookie(SESSION_COOKIE_NAME, sessionToken, cookieOptions);
    res.status(200).json({
      user,
      sessionToken, // Included for API/mobile clients as well
    });
  } catch (error) {
    next(error);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (token) {
      await authService.logout(token);
    }

    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
}

export async function getMeHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.adminUser) {
      throw new UnauthorizedError("Authentication required");
    }

    const user = await authService.getMe(req.adminUser.id);
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function changePasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.adminUser) {
      throw new UnauthorizedError("Authentication required");
    }

    const input = changePasswordSchema.parse(req.body);
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const ua = req.headers["user-agent"];

    const { sessionToken } = await authService.changePassword(req.adminUser.id, input, ip, ua);

    res.cookie(SESSION_COOKIE_NAME, sessionToken, cookieOptions);
    res.status(200).json({
      success: true,
      message: "Password changed successfully. Other sessions have been revoked.",
      sessionToken,
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new ValidationError("Valid email address is required");
    }

    res.status(200).json({
      success: true,
      message: "Password reset instructions dispatched.",
      demoToken: "MESS-8492",
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      throw new ValidationError("Email, token, and new password are required");
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      throw new ValidationError("New password must be at least 8 characters");
    }

    await authService.mockResetPassword(email, newPassword);

    res.status(200).json({
      success: true,
      message: "Password updated successfully. You can now log in.",
    });
  } catch (error) {
    next(error);
  }
}
