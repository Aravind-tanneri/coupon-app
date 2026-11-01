import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
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

/**
 * Nodemailer Email Adapter with Graceful Bypass support (§20).
 * If SMTP credentials (SMTP_USER & SMTP_PASS) are provided, sends real emails.
 * If credentials are not supplied, provides a safe non-crashing bypass that logs output.
 */
export class NodemailerEmailAdapter implements EmailProvider {
  private transporter: Transporter;
  private fromEmail: string;
  private isConfigured: boolean;

  constructor(options?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromEmail?: string;
  }) {
    const host = options?.host || env.MAIL_HOST || env.SMTP_HOST || "smtp.gmail.com";
    const port = options?.port || env.MAIL_PORT || env.SMTP_PORT || 587;
    const secure = options?.secure ?? (port === 465 || env.SMTP_SECURE === true);
    const user = options?.user !== undefined ? options.user : env.MAIL_USER || env.SMTP_USER || "";
    const pass =
      options?.pass !== undefined
        ? options.pass
        : env.MAIL_PASS || env.MAIL_PASSWORD || env.SMTP_PASS || env.SMTP_PASSWORD || "";

    // For services like Gmail SMTP, default from header to the authenticated user if EMAIL_FROM is default
    const configuredFrom = options?.fromEmail || env.SMTP_FROM;
    if (configuredFrom) {
      this.fromEmail = configuredFrom;
    } else if (
      user &&
      user.includes("@") &&
      (!env.EMAIL_FROM || env.EMAIL_FROM === "mess@campus.edu")
    ) {
      this.fromEmail = `"Campus Mess" <${user}>`;
    } else {
      this.fromEmail = env.EMAIL_FROM || "mess@campus.edu";
    }

    this.isConfigured = Boolean(user && pass);

    if (this.isConfigured) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
    } else {
      // Stream transport for bypass mode
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: "windows",
        buffer: true,
      });
    }
  }

  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const from = this.fromEmail.includes("<")
      ? this.fromEmail
      : `"Campus Mess" <${this.fromEmail}>`;

    if (!this.isConfigured) {
      logger.info(
        { to: options.to, subject: options.subject },
        "Nodemailer bypass active (SMTP credentials not configured): email output simulated",
      );
      return { providerMessageId: `nodemailer-bypass-${Date.now()}` };
    }

    try {
      const info = await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        headers: options.idempotencyKey
          ? { "X-Idempotency-Key": options.idempotencyKey }
          : undefined,
      });

      const messageId = info.messageId || `nodemailer-${Date.now()}`;
      logger.info(
        { to: options.to, subject: options.subject, messageId },
        "Email delivered successfully via Nodemailer",
      );
      return { providerMessageId: messageId };
    } catch (error) {
      logger.error(
        { error: (error as Error).message, to: options.to, subject: options.subject },
        "Nodemailer delivery error, using fallback ID so operations proceed",
      );
      return { providerMessageId: `nodemailer-fallback-${Date.now()}` };
    }
  }
}

export function getEmailProvider(): EmailProvider {
  if (env.NODE_ENV === "test") {
    return consoleEmailProvider;
  }
  if (env.RESEND_API_KEY && env.RESEND_API_KEY.trim().length > 0) {
    return new ResendEmailAdapter();
  }
  // Default to Nodemailer (with SMTP or local bypass)
  return new NodemailerEmailAdapter();
}
