import { Router } from "express";
import {
  loginHandler,
  logoutHandler,
  getMeHandler,
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "./auth.controller.js";
import { checkLoginRateLimit } from "../../middleware/rateLimit.js";
import { requireAuth } from "../../middleware/session.js";

export const authRouter = Router();

authRouter.post("/login", checkLoginRateLimit(), loginHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth, getMeHandler);
authRouter.post("/change-password", requireAuth, changePasswordHandler);
authRouter.post("/forgot-password", forgotPasswordHandler);
authRouter.post("/resend-otp", forgotPasswordHandler);
authRouter.post("/reset-password", resetPasswordHandler);
