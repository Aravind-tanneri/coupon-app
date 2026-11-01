import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.id !== undefined ? String(req.id) : undefined;

  if (err instanceof AppError) {
    logger.warn(
      {
        err,
        code: err.code,
        statusCode: err.statusCode,
        requestId,
        path: req.path,
        method: req.method,
      },
      `AppError [${err.code}]: ${err.message}`,
    );

    const envelope: ErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    };

    res.status(err.statusCode).json(envelope);
    return;
  }

  if (err instanceof ZodError) {
    const errorMessages = err.issues
      .map((i) => `${i.path.join(".") || "field"}: ${i.message}`)
      .join(", ");
    logger.warn(
      {
        err,
        issues: err.issues,
        requestId,
        path: req.path,
        method: req.method,
      },
      `ZodError: ${errorMessages}`,
    );

    const envelope: ErrorEnvelope = {
      error: {
        code: "VALIDATION_ERROR",
        message: errorMessages || "Request validation failed",
        details: err.issues,
        requestId,
      },
    };

    res.status(400).json(envelope);
    return;
  }

  // Handle express JSON body parsing syntax errors
  if ("status" in err && (err as { status?: unknown }).status === 400 && "body" in err) {
    const envelope: ErrorEnvelope = {
      error: {
        code: "INVALID_JSON",
        message: "Malformed JSON payload in request body",
        requestId,
      },
    };
    res.status(400).json(envelope);
    return;
  }

  // Unhandled / Internal Server Errors
  logger.error(
    {
      err,
      requestId,
      path: req.path,
      method: req.method,
    },
    `Unhandled error: ${err.message}`,
  );

  const envelope: ErrorEnvelope = {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message:
        env.NODE_ENV === "production"
          ? "An unexpected internal server error occurred"
          : err.message || "An unexpected error occurred",
      requestId,
    },
  };

  res.status(500).json(envelope);
};
