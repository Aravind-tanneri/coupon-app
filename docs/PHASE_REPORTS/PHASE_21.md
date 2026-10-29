# Phase 21 Report: Gift Email Delivery & Outbox Architecture

## Headline Implementation Verification

- **Email Provider Abstraction (§20, §21.1):**
  - Unified `EmailProvider` interface defined with options `{ to, subject, html, text, idempotencyKey, tags }`.
  - `ResendEmailAdapter`: Production adapter communicating with Resend REST API, passing provider-level `Idempotency-Key` headers and metadata tags to prevent duplicate delivery.
  - `ConsoleEmailProvider`: In-memory and development provider capturing sent messages with simulated delivery rejection support for test suites.
- **Outbox Pattern & Worker Processor (§20, §21.2):**
  - `EmailOutboxWorker.processOutbox`: Periodically polls `Notification` table for `channel=EMAIL` and `status=PENDING` with due `nextAttemptAt`.
  - Up to 3 delivery attempts with exponential backoff (`2^attempts * 60s`).
  - Transactional state transitions: `PENDING → SENT` upon successful transmission; updates `GiftItem.emailStatus` to `SENT`.
  - Terminal failure transition to `FAILED` after 3 consecutive errors, recording detailed diagnostic messages.
- **Responsive Email Template & Privacy Integrity (§20, §21.3):**
  - Table-based layout optimized for Gmail and Outlook rendering widths (600px ceiling).
  - Clean typography featuring Dining Hall, occasion banner, meal date (IST), prominent Crockford base32 short code, and direct button linking to `/c/<token>`.
  - **CRITICAL AC (§20):** Absolutely zero internal database IDs (no CUIDs, UUIDs, or student database keys) exposed in email subject, HTML markup, or plain text fallback.
- **Delivery & Bounce Webhook Handler (§20, §21.4):**
  - Mounted at `POST /api/v1/notifications/email/webhook` with CSRF protection exemption.
  - Constant-time cryptographic signature verification for Svix/Resend HMAC signatures (`svix-signature` and `x-resend-signature`) with 5-minute timestamp tolerance.
  - Anti-replay deduplication using `WebhookEvent(provider: 'RESEND', eventId)` table.
  - Real-time status updates:
    - `email.delivered`: Sets `Notification.status = DELIVERED`, updates `GiftItem.emailStatus = DELIVERED`.
    - `email.bounced` / `email.complained`: Sets `Notification.status = BOUNCED`, records reason, updates `GiftItem.emailStatus = BOUNCED`, and emits audit alert.
- **Batch Error Isolation & Resilience (§21.5, §29):**
  - Outbox processing loop isolates each notification in its own error-handling boundary.
  - A failure on one recipient (e.g. invalid domain, bounce) does not halt, crash, or interrupt the delivery of other recipients in the batch.

## Verification

- Notification Unit Suite: `backend/src/modules/notifications/email.test.ts` (9/9 passing).
- Full Verification: `npm run check:all` (41 test files, 312 tests passing, zero TypeScript/ESLint warnings).

### Ready for Phase 22: YES
