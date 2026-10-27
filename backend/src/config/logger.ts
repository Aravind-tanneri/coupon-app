import { pino } from "pino";
import { env } from "./env.js";

const isTest = env.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "otp",
      "phone",
      "payoutDetails",
      "encryptedPayout",
      "*.password",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
