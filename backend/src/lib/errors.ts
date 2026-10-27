export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export class InvalidJsonError extends AppError {
  constructor(message = "Malformed JSON payload in request body") {
    super(400, "INVALID_JSON", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden: Insufficient privileges") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT", details?: unknown) {
    super(409, code, message, details);
  }
}

export class StaleVersionError extends AppError {
  constructor(
    message = "Request conflict: Record was modified concurrently by another user. Please reload.",
  ) {
    super(409, "STALE_VERSION", message);
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, details);
  }
}

export class IdempotencyMismatchError extends AppError {
  constructor(
    message = "Idempotency-Key reuse violation: The provided key was previously submitted with a different request payload.",
  ) {
    super(422, "IDEMPOTENCY_MISMATCH", message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super(429, "TOO_MANY_REQUESTS", message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = "An unexpected internal server error occurred") {
    super(500, "INTERNAL_SERVER_ERROR", message);
  }
}
