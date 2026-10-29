import { env } from "../../config/env.js";

export interface GiftCouponEmailContext {
  studentName: string;
  mealDate: string;
  shortCode: string;
  rawToken: string;
  occasionMessage?: string | null;
  messName?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders table-based responsive HTML layout and plain text alternative for Gift Coupons (§20.3).
 * Compatible across Gmail and Outlook client widths.
 * CRITICAL SECURITY (§20): Contains NO internal database IDs (no CUIDs/UUIDs).
 */
export function renderGiftCouponEmail(context: GiftCouponEmailContext): RenderedEmail {
  const occasion = context.occasionMessage || "Special Dinner Feast";
  const mess = context.messName || "Campus Dining Hall";
  const passUrl = `${env.FRONTEND_URL}/c/${context.rawToken}`;
  const subject = `🎁 Your Complimentary Pass for ${occasion} (${context.mealDate})`;

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${occasion}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 24px 0;">
    <tr>
      <td align="center">
        <!-- Main Container (600px width limit) -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Header Banner -->
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); background-color: #059669; padding: 32px 24px; color: #ffffff;">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <span style="display: inline-block; font-size: 36px; line-height: 40px; margin-bottom: 8px;">🎁</span>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Complimentary Dining Pass</h1>
                    <p style="margin: 6px 0 0 0; font-size: 14px; color: #d1fae5; font-weight: 500;">${mess}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 28px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 24px; color: #334155;">
                Hello <strong>${context.studentName}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #475569;">
                You have been gifted a complimentary <strong style="color: #0f172a;">Special Dinner Coupon</strong> for <strong style="color: #059669;">${occasion}</strong>.
              </p>

              <!-- Coupon Voucher Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0fdf4; border: 2px dashed #86efac; border-radius: 12px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #166534;">
                      Counter Short Code
                    </p>
                    <div style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #047857; margin: 8px 0;">
                      ${context.shortCode}
                    </div>
                    <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin-top: 12px;">
                      <tr>
                        <td align="center" style="font-size: 13px; color: #15803d;">
                          <strong>Meal Date:</strong> ${context.mealDate} &nbsp;|&nbsp; <strong>Meal:</strong> Special Dinner
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Call to Action Button -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" bgcolor="#059669" style="border-radius: 10px;">
                          <a href="${passUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px; border: 1px solid #059669;">
                            View Digital QR Pass &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Instructions -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #1e293b;">
                  How to redeem at the counter:
                </p>
                <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 20px; color: #64748b;">
                  <li>Present the 8-character code <strong>${context.shortCode}</strong> to staff at the dining hall entrance.</li>
                  <li>Or tap the button above to show the QR pass directly from your phone.</li>
                  <li>This pass is valid exclusively for dinner on <strong>${context.mealDate}</strong>.</li>
                </ol>
              </div>

              <!-- Security Notice -->
              <p style="margin: 0; font-size: 12px; line-height: 18px; color: #94a3b8; text-align: center;">
                No login is required to view your pass. Please keep this token private.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                Campus Dining Automation &middot; Sent on behalf of ${mess}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `COMPLIMENTARY DINING PASS: ${occasion}
--------------------------------------------------
Hello ${context.studentName},

You have received a complimentary Special Dinner pass for ${occasion} at ${mess}.

COUNTER CODE: ${context.shortCode}
MEAL DATE:    ${context.mealDate} (Special Dinner)

View your digital QR pass:
${passUrl}

How to redeem:
1. Provide the 8-character code ${context.shortCode} to dining staff at the counter.
2. Or open the link above to display your verified digital QR code.
3. This pass is valid exclusively for dinner on ${context.mealDate}.

This is an automated notification from ${mess}.`;

  return { subject, html, text };
}
