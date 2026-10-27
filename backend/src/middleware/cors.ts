import cors from "cors";
import { env } from "../config/env.js";

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile bot webhooks, curl, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    const allowedOrigin = new URL(env.FRONTEND_URL).origin;
    if (origin === allowedOrigin || origin === `http://localhost:${env.PORT}`) {
      return callback(null, true);
    }

    // Disallowed origins will not have Access-Control headers and will be gated by CSRF
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Request-Id",
    "Idempotency-Key",
  ],
});
