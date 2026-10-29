import { logger } from "../../config/logger.js";
import { ExternalServiceError } from "../../lib/errors.js";

export interface CircuitBreakerOptions {
  failureThreshold?: number; // default: 5
  cooldownPeriodMs?: number; // default: 60000 (60s)
}

export class CircuitBreaker {
  private failureCount = 0;
  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private nextAttemptTime = 0;
  private state: "CLOSED" | "OPEN" = "CLOSED";

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 60000;
  }

  isOpen(): boolean {
    if (this.state === "OPEN") {
      if (Date.now() >= this.nextAttemptTime) {
        // Cooldown passed, allow one trial attempt (half-open behavior)
        logger.info("Circuit breaker cooldown passed, transitioning to half-open trial");
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    if (this.failureCount > 0 || this.state === "OPEN") {
      logger.info("Circuit breaker reset after successful execution");
    }
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  recordFailure(error: unknown): void {
    this.failureCount++;
    logger.warn(
      { failureCount: this.failureCount, threshold: this.failureThreshold, err: error },
      "Circuit breaker recorded failure",
    );

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextAttemptTime = Date.now() + this.cooldownPeriodMs;
      logger.error(
        {
          cooldownMs: this.cooldownPeriodMs,
          nextAttemptAt: new Date(this.nextAttemptTime).toISOString(),
        },
        "Circuit breaker OPENED: tripping downstream calls for cooldown period",
      );
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new ExternalServiceError(
        "AI service temporarily unavailable (circuit breaker is OPEN). Please try manual commands.",
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
    this.nextAttemptTime = 0;
  }
}
