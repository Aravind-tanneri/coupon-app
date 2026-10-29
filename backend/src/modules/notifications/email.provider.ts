import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  providerMessageId: string;
}

export interface EmailProvider {
  send(options: SendEmailOptions): Promise<SendEmailResult>;
}

/**
 * Production Resend Email Adapter (§20).
 * Passes Idempotency-Key and tags to avoid duplicate transmission.
 */
export class ResendEmailAdapter implements EmailProvider {
  private apiKey: string;
  private fromEmail: string;

  constructor(apiKey?: string, fromEmail?: string) {
    this.apiKey = apiKey || env.RESEND_API_KEY || "";
    this.fromEmail = fromEmail || env.EMAIL_FROM || "mess@campus.edu";
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const payload: Record<string, unknown> = {
      from: this.fromEmail,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    };

    if (options.tags) {
      payload.tags = Object.entries(options.tags).map(([name, value]) => ({
        name,
        value,
      }));
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { errorText, status: response.status, to: options.to },
        "Resend API email transmission failed",
      );
      throw new Error(`Email delivery provider error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { id: string };
    return { providerMessageId: data.id };
  }
}

export interface RecordedEmail extends SendEmailOptions {
  id: string;
  sentAt: Date;
}

/**
 * Console & In-Memory Email Provider for development and automated test suites (§20).
 */
export class ConsoleEmailProvider implements EmailProvider {
  private sentEmails: RecordedEmail[] = [];
  private shouldFailPredicate: ((options: SendEmailOptions) => boolean) | null = null;

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (this.shouldFailPredicate && this.shouldFailPredicate(options)) {
      logger.warn({ to: options.to }, "ConsoleEmailProvider simulated rejection for recipient");
      throw new Error(`Simulated email delivery rejection for ${options.to}`);
    }

    const id = `console-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const record: RecordedEmail = {
      ...options,
      id,
      sentAt: new Date(),
    };

    this.sentEmails.push(record);
    logger.info(
      { to: options.to, subject: options.subject, messageId: id },
      "Email delivered via ConsoleEmailProvider",
    );

    return { providerMessageId: id };
  }

  getSentEmails(): RecordedEmail[] {
    return [...this.sentEmails];
  }

  clear(): void {
    this.sentEmails = [];
    this.shouldFailPredicate = null;
  }

  setShouldFail(predicate: ((options: SendEmailOptions) => boolean) | boolean): void {
    if (typeof predicate === "boolean") {
      this.shouldFailPredicate = predicate ? () => true : null;
    } else {
      this.shouldFailPredicate = predicate;
    }
  }
}

// Global console provider instance for tests
export const consoleEmailProvider = new ConsoleEmailProvider();

export function getEmailProvider(): EmailProvider {
  if (env.NODE_ENV !== "test" && env.RESEND_API_KEY) {
    return new ResendEmailAdapter();
  }
  return consoleEmailProvider;
}
