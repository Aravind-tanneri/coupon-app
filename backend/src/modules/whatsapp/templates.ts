import { TemplateComponent } from "./whatsapp.types.js";

export interface RegisteredTemplate {
  name: string;
  category: "UTILITY" | "AUTHENTICATION";
  language: string;
  description: string;
}

export const WHATSAPP_TEMPLATES = {
  REIMBURSEMENT_STATUS_UPDATE: {
    name: "reimbursement_status_update",
    category: "UTILITY",
    language: "en",
    description:
      "Notifies student when reimbursement claim status changes (e.g., approved, paid, info needed)",
  },
  COUPON_READY: {
    name: "coupon_ready",
    category: "UTILITY",
    language: "en",
    description: "Sends coupon purchase confirmation and access details",
  },
  SPECIAL_DINNER_GIFT: {
    name: "special_dinner_gift",
    category: "UTILITY",
    language: "en",
    description: "Notifies student about an issued special meal gift coupon",
  },
  OTP_VERIFICATION: {
    name: "otp_verification",
    category: "AUTHENTICATION",
    language: "en",
    description: "Delivers 6-digit authentication OTP to verify identity",
  },
} as const;

export function buildReimbursementStatusTemplate(
  studentName: string,
  publicRef: string,
  status: string,
  remarksOrAmount?: string,
): TemplateComponent[] {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: studentName },
        { type: "text", text: publicRef },
        { type: "text", text: status },
        { type: "text", text: remarksOrAmount || "Check portal for details" },
      ],
    },
  ];
}

export function buildCouponReadyTemplate(
  studentName: string,
  mealType: string,
  dateFormatted: string,
  shortCode: string,
): TemplateComponent[] {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: studentName },
        { type: "text", text: mealType },
        { type: "text", text: dateFormatted },
        { type: "text", text: shortCode },
      ],
    },
  ];
}

export function buildSpecialDinnerGiftTemplate(
  studentName: string,
  mealDateFormatted: string,
  message: string,
): TemplateComponent[] {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: studentName },
        { type: "text", text: mealDateFormatted },
        { type: "text", text: message },
      ],
    },
  ];
}

export function buildOtpTemplate(otpCode: string): TemplateComponent[] {
  return [
    {
      type: "body",
      parameters: [{ type: "text", text: otpCode }],
    },
    {
      type: "button",
      sub_type: "url",
      index: 0,
      parameters: [{ type: "text", text: otpCode }],
    },
  ];
}
