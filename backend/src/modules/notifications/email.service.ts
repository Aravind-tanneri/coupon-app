import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  async sendEmail(options: EmailOptions): Promise<{ id: string }> {
    if (env.NODE_ENV === "test" || !env.RESEND_API_KEY) {
      logger.info(
        { to: options.to, subject: options.subject },
        "Email delivery simulated (test/dev environment)",
      );
      return { id: `email-mock-${Date.now()}` };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ errorText, status: response.status }, "Resend email delivery failed");
        throw new Error(`Email provider error: ${response.statusText}`);
      }

      const data = (await response.json()) as { id: string };
      return { id: data.id };
    } catch (err) {
      logger.error({ err, to: options.to }, "Failed to send email");
      throw err;
    }
  }

  async sendOtpEmail(toEmail: string, studentName: string, otpCode: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1e3a8a;">Campus Mess WhatsApp Linking</h2>
        <p>Hello ${studentName},</p>
        <p>Your one-time verification code to link your WhatsApp account is:</p>
        <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #2563eb; padding: 16px; background-color: #f1f5f9; border-radius: 8px; text-align: center; margin: 20px 0;">
          ${otpCode}
        </div>
        <p style="color: #64748b; font-size: 14px;">This code will expire in 10 minutes. If you did not request this verification, please contact mess administration immediately.</p>
      </div>
    `;

    await this.sendEmail({
      to: toEmail,
      subject: "Campus Mess Verification Code",
      html,
      text: `Your Campus Mess WhatsApp linking verification code is: ${otpCode}. It expires in 10 minutes.`,
    });
  }
}

export const emailService = new EmailService();
