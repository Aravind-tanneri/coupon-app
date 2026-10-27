import express, { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandler } from "./middleware/errorHandler.js";
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

  // Request ID
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

  // Health check endpoint
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "campus-mess-backend",
    });
  });

  // Custom / module route registration
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
