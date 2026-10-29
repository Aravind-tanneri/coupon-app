import express, { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { corsMiddleware } from "./middleware/cors.js";
import { csrfProtection } from "./middleware/csrf.js";
import { sessionMiddleware } from "./middleware/session.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { userRouter } from "./modules/auth/user.routes.js";
import { studentRouter } from "./modules/students/student.routes.js";
import { menuRouter } from "./modules/menus/menu.routes.js";
import { feedbackRouter } from "./modules/feedback/feedback.routes.js";
import { couponRouter } from "./modules/coupons/coupon.routes.js";
import { redemptionRouter } from "./modules/redemptions/redemption.routes.js";
import {
  reimbursementRouter,
  policyRouter,
} from "./modules/reimbursements/reimbursement.routes.js";
import { whatsAppRouter } from "./modules/whatsapp/whatsapp.routes.js";
import { NotFoundError } from "./lib/errors.js";

export interface CreateAppOptions {
  enableLogging?: boolean;
  setupRoutes?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Cross-Origin Resource Sharing
  app.use(corsMiddleware);

  // Request ID tracking
  app.use(requestIdMiddleware);

  // HTTP Request Logging
  if (options.enableLogging ?? process.env.NODE_ENV !== "test") {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id || "unknown",
        customLogLevel: (_req, res, err) => {
          if (res.statusCode >= 500 || err) return "error";
          if (res.statusCode >= 400) return "warn";
          return "info";
        },
      }),
    );
  }

  // Parse JSON bodies while capturing rawBody for webhook HMAC checks
  app.use(
    express.json({
      limit: "10mb",
      verify: (req: Request, _res: Response, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Cookie parsing for server-side sessions
  app.use(cookieParser());

  // Session authentication middleware (populates req.adminUser & req.session)
  app.use(sessionMiddleware);

  // CSRF protection for mutating requests
  app.use(csrfProtection);

  // Health check endpoint
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "campus-mess-backend",
    });
  });

  // API v1 Routes
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", userRouter);
  app.use("/api/v1/students", studentRouter);
  app.use("/api/v1/menus", menuRouter);
  app.use("/api/v1/feedback", feedbackRouter);
  app.use("/api/v1/coupons", couponRouter);
  app.use("/api/v1/redemptions", redemptionRouter);
  app.use("/api/v1/reimbursements", reimbursementRouter);
  app.use("/api/v1/reimbursement-policy", policyRouter);
  app.use("/api/v1/whatsapp", whatsAppRouter);

  // Custom / module route registration hook (for testing and extensions)
  if (options.setupRoutes) {
    options.setupRoutes(app);
  }

  // Catch-all for undefined routes
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}
