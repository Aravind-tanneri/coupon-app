import cors from "cors";

export const corsMiddleware = cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Request-Id",
    "Idempotency-Key",
    "Accept",
    "Origin",
  ],
  optionsSuccessStatus: 200,
});
