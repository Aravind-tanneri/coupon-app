import { getEmailProvider } from "./email.provider.js";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  async sendEmail(options: EmailOptions): Promise<{ id: string }> {
    const provider = getEmailProvider();
    const result = await provider.send({
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return { id: result.providerMessageId };
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

  async sendPasswordResetEmail(toEmail: string, otpCode: string): Promise<void> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #059669;">Campus Mess - Password Reset</h2>
        <p>Hello,</p>
        <p>A request was received to reset your password for the Campus Mess System.</p>
        <p>Your one-time password (OTP) verification code is:</p>
        <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #059669; padding: 16px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; text-align: center; margin: 20px 0;">
          ${otpCode}
        </div>
        <p style="color: #64748b; font-size: 14px;">This code will expire in 15 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `;

    await this.sendEmail({
      to: toEmail,
      subject: "Campus Mess - Password Reset OTP",
      html,
      text: `Your Campus Mess password reset code is: ${otpCode}. This code expires in 15 minutes.`,
    });
  }
}

export const emailService = new EmailService();
