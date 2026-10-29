# Campus Mess System: System Architecture

## 1. System Overview

The Campus Mess System is an enterprise-grade, full-stack campus platform managing meal coupons, dining menus, student absence reimbursements, dining feedback, and administrative operations.

It exposes two distinct interfaces:

1. **Student Channel (WhatsApp + Minimal Web Checkout):** Conversational AI bot powered by the Meta WhatsApp Cloud API and Google Gemini 2.0 Flash for language comprehension and tool dispatching.
2. **Operations & Admin Channel (React Web SPA):** Administrative web console for mess staff, kitchen managers, and finance officers.

```
Student → WhatsApp Cloud API → POST /whatsapp/webhook ─┐
                                                       ▼
                                          [verify sig → dedupe → enqueue → 200]
                                                       ▼
                                    Worker: Conversation Manager (per-identity lock)
                                       ├─ deterministic router (buttons/lists/state)
                                       └─ Gemini (intent + entities + tool selection)
                                                       ▼
                                          Domain services (single source of truth)
                                                       ▼
                                                    PostgreSQL
Admin → React SPA ──REST (cookie session)──► same domain services
Razorpay ──webhook──► payments module ──► coupons module
Email provider ──webhook──► notifications module
```

---

## 2. Layering & Modular Monolith

The backend is structured as a **modular monolith** with single-responsibility layering:

```
Routes → Controllers / WhatsApp Handlers → Domain Services → Repositories (Prisma & raw SQL)
```

- **Domain Services are the single source of truth:** All business rules, validations, financial calculations, and state machines reside strictly within domain services.
- **Adapters are thin:** Admin REST controllers, WhatsApp webhook processors, and Gemini function tools call the exact same domain services.
- **Postgres-Backed Queue (`pg-boss`):** Outbox email dispatch, asynchronous notifications, and message processing run via `pg-boss` jobs. No Redis instance is required.

---

## 3. Database & Data Integrity

- **Database Engine:** PostgreSQL 16+ with the `btree_gist` extension enabled.
- **ORM:** Prisma ORM for standard relations, CRUD, and migrations, supplemented by raw SQL migrations for specialized constraints.
- **Currency & Money:** All financial figures (rates, coupons, payments, reimbursements) are stored as integers representing **paise** (`Int`), never floats.
- **Timezone:** All calendar dates, meal windows, and daily cutoffs operate strictly in `Asia/Kolkata` (IST).
- **Concurrency & Overlap Constraints:**
  - Double redemption prevented by atomic `UPDATE ... WHERE status = 'ACTIVE' AND messId = $1` returning the affected row.
  - Duplicate absence claims prevented by PostgreSQL exclusion constraints (`EXCLUDE USING gist`) over stored date ranges.
  - Concurrent admin claim reviews prevented via `version` optimistic locking.

---

## 4. Security Architecture

- **Admin Authentication:** Argon2id password hashing + server-side session management stored in PostgreSQL (`Session` table).
- **Session Cookies:** `HttpOnly; Secure; SameSite=Lax; Path=/` with 8-hour idle expiry and 7-day absolute TTL.
- **CSRF Protection:** Strict `SameSite` cookie policy + `X-Requested-With` custom header verification + strict `Origin` matching on state-mutating HTTP methods.
- **Student Authentication:** Institutional roster matching followed by institutional email OTP verification. Once linked, the phone number maps directly to the verified `studentId`.
- **Payout Details Security:** Student bank accounts and UPI IDs are encrypted at rest using AES-256-GCM and masked (last 4 characters) in administrative views.
- **AI Safety & Anti-Prompt-Injection:**
  - Context isolation: `studentId` and `messId` are derived securely from server context and never passed as model parameters.
  - Tool restrictions: Gemini cannot invoke financial mutation tools or admin tools.
  - Deterministic templates: All financial balances, amounts, and dates are rendered by backend templates.

---

## 5. API Design Conventions

- **Base Path:** `/api/v1`
- **Standard Error Envelope:**
  ```json
  {
    "error": {
      "code": "ERROR_CODE",
      "message": "Human-readable description",
      "details": {},
      "requestId": "uuid"
    }
  }
  ```
- **Mutation Idempotency:** Sensitive mutations (payments, claim approvals, gift batch issuance) require an `Idempotency-Key` header with a 24-hour deduplication window.

---

## 6. Project Workspaces & File Layout

```
coupon-app/
├── docs/                     # Architectural documents, ADRs, phase reports
├── .github/workflows/        # CI/CD pipelines
├── backend/                  # Express REST API, WhatsApp bot & worker services
│   ├── src/
│   │   ├── config/           # Zod env parsing, logger, constants
│   │   ├── middleware/       # Request ID, helmet, error handler, auth, CSRF
│   │   ├── lib/              # Errors, dates-IST, money, crypto
│   │   ├── modules/          # Business domain modules
│   │   ├── app.ts            # Express application factory
│   │   └── server.ts         # HTTP server entrypoint
│   └── tests/
└── frontend/                 # React + Vite + Tailwind CSS admin SPA
    ├── src/
    │   ├── components/       # Reusable UI components
    │   ├── pages/            # Admin routes and views
    │   ├── lib/              # API clients and utilities
    │   └── App.tsx
    └── index.html
```

---

## 7. Production Topology & Verification Status

- **Web Server:** Render Web Service (`campus-mess-api`) running Node.js 22 with Let's Encrypt TLS 1.3 at `api.campusmess.in`.
- **Worker Process:** Render Background Worker (`campus-mess-worker`) consuming `pg-boss` queues.
- **Frontend SPA:** Vercel Edge Network at `admin.campusmess.in` with immutable asset caching and SPA fallbacks.
- **Public Coupon Pass:** Minimal Zero-PII pass `/c/:token` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- **Database:** Managed PostgreSQL 16 instance with automated daily backups and automated release migrations (`prisma migrate deploy`).
- **Automated Verification:** 45 backend test suites (340 tests), 5 frontend test suites (16 tests), 3 end-to-end integration flows, 50-thread concurrency suites, and automated smoke test (`scripts/smoke-test.ts`).
