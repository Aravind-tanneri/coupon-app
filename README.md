# Campus Mess System

> **An automated, multi-tenant campus dining, coupon issuance, absence rebate, and conversational WhatsApp management platform.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-6.4-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.x-38B2AC.svg)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-358%20Passed-success.svg)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 1. Problem Statement

Across university campuses with thousands of resident students, dining operations face systemic logistical and financial friction:

- **Cash Queues & Inflexible Coupon Buying:** Students line up at administrative counters during restricted office hours to buy paper guest meal coupons with cash.
- **Lost Absence Rebates:** Students away for official events, internships, or medical reasons lose hundreds of rupees because filing for rebates requires manual paperwork and physical signatures across departments.
- **Counter Fraud & Headcount Mismatches:** Paper coupons are prone to double redemption and counterfeiting, leaving dining halls vulnerable to food shortages or unbudgeted preparation deficits.
- **Opaque Kitchen Operations & Feedback Gaps:** Dining managers lack real-time visibility into expected meal headcounts and dietary trends, while student food feedback is lost in physical suggestion boxes.
- **Administrative Overhead:** Mess wardens, accounts officers, and caterers lack a unified, role-scoped system to track attendance, audit rebate eligibility, disburse refunds, and issue festival feast gifts.

---

## 2. Solution

The **Campus Mess System** provides an end-to-end, enterprise-grade digital operating system tailored for university dining:

1. **Zero-App-Installation Student Experience:** Powered by a conversational WhatsApp bot (**Meta WhatsApp Cloud API** + **Google Gemini 2.0 Flash**), students can check live menus, purchase extra-meal coupons via Razorpay, receive tamper-proof QR passes, submit mathematical absence rebate claims, and upload leave slips.
2. **Sub-50ms Counter Scanner Console:** Touchscreen and handheld barcode/QR scanner web console for dining staff. Backed by atomic PostgreSQL updates (`ACTIVE -> REDEEMED`) that definitively block double redemptions.
3. **Audited Administrative & Financial Governance:** Role-Based Access Control (**Super Admin**, **Mess Admin**, **Finance Admin**, **Counter Staff**) to curate menus, approve rebate claims with optimistic concurrency versioning, disburse payments, issue bulk festival feast passes, and inspect immutable audit logs.
4. **Zero-Float Financial Precision:** All financial figures (rates, coupons, payments, reimbursements) are strictly calculated and stored in integer **paise** (`Int`), eliminating floating-point rounding errors. Database exclusion constraints (`EXCLUDE USING gist`) prevent overlapping absence claims at the storage engine level.

---

## 3. Features

### Student User-Facing Features (WhatsApp & Public Pass)

- **Roster-Backed WhatsApp Authentication:** Students link their registered WhatsApp number using a one-time 6-digit institutional email OTP challenge.
- **Live Menu & Dietary Inquiries:** Query breakfast, lunch, snacks, and dinner menus with dietary tags (`VEG`, `NON_VEG`, `EGG`, `JAIN`, `SPECIAL`).
- **Extra-Meal Coupon Purchases:** Browse catalog prices and receive an instant, single-use Razorpay checkout link (`/pay/:orderToken`).
- **Tamper-Proof QR & Short Code Passes:** Instant coupon retrieval via WhatsApp with a high-contrast QR code and an 8-character Crockford base32 code (`/c/:token`) with zero PII exposure.
- **Autonomous Absence Rebate Calculator:** Automatically validates eligibility against university policy (minimum 3 consecutive days, departure day exclusion, term ceilings, and retroactive windows).
- **In-Chat Document Upload:** Uploads medical leave or travel approvals directly via WhatsApp media with strict magic-byte validation and malware prevention.
- **Special Feast Gift Passes:** Receive complimentary banquet passes issued by hall wardens with occasion banners and direct redemption tokens.
- **Dining Feedback & Photo Upload:** Rate meals (1–5 stars) with categorized dish feedback and photo uploads.

### Administrative & Operations Features (Web Portal)

- **Role-Based Workspaces:** Scoped permissions for wardens, mess caterers, accountants, and counter attendants.
- **Real-Time Scanner Console:** High-throughput barcode/QR scanner with instant visual and audio chime feedback for meal eligibility.
- **Rebate Claim Adjudication:** Review queue featuring mathematical calculation breakdowns, 60-second temporary signed document URLs, and optimistic locking (`STALE_VERSION` rejection).
- **Financial Disbursement Manifests:** Record bank NEFT/IMPS/UPI UTR numbers, triggering instant push notification updates to students.
- **Festival Gift Pass Batches:** Issue feast passes in bulk with multi-select student search, client-side idempotency deduplication, and atomic revocation protection.
- **Emergency Broadcast Announcements:** Publish instant text announcements across all dining halls.
- **Immutable Audit Ledger:** Non-repudiation audit trail recording every state mutation, administrative review, and document access.

---

## 4. Tech Stack

| Layer                  | Technology                                | Details / Purpose                                                       |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| **Frontend**           | React 19, Vite, TypeScript                | Single Page Application (SPA), component-driven design                  |
| **Styling & UI**       | Tailwind CSS 4, Lucide Icons              | Responsive mobile-first admin console and public token pass             |
| **State & Networking** | React Hooks, Context API, Native Fetch    | Lightweight state ownership, zero heavy store dependencies              |
| **Backend Runtime**    | Node.js 22 LTS (ES Modules)               | High-performance asynchronous execution engine                          |
| **API Framework**      | Express 4.x, TypeScript                   | Modular monolith with layered controllers and services                  |
| **Validation**         | Zod 3.x                                   | Runtime validation of request bodies, queries, params, and env vars     |
| **Database & ORM**     | PostgreSQL 16+, Prisma ORM 6.4            | Relational persistence, migrations, and `btree_gist` constraints        |
| **Background Queues**  | `pg-boss` (PostgreSQL-backed)             | Outbox pattern for emails, WhatsApp pushes, and webhook processing      |
| **Authentication**     | Argon2id, Express Session                 | SHA-256 hashed session IDs in PostgreSQL, HTTP-only Secure Lax cookies  |
| **AI / NLU**           | Google Gemini 2.0 Flash (`@google/genai`) | Intent classification, entity extraction, and structured tool selection |
| **Payments**           | Razorpay Node SDK                         | Online checkout orders, HMAC raw-body webhook verification              |
| **Messaging**          | Meta WhatsApp Cloud API                   | Official WhatsApp Business Graph API for interactive student messaging  |
| **Email Delivery**     | Resend / SES / `ConsoleEmailProvider`     | Transactional email delivery with SPF, DKIM, and DMARC support          |
| **Object Storage**     | S3 / Cloudflare R2 Compatible             | Private bucket storage, UUID keys, 60-second temporary signed URLs      |
| **Security & Headers** | Helmet, CORS, CSRF Protection             | HSTS, strict CSP, `no-store` cache controls, custom header verification |
| **Testing**            | Vitest 3.x, Supertest                     | 358 automated tests: unit, integration, concurrency, load, and smoke    |
| **Code Quality**       | ESLint 9, Prettier 3, Husky, lint-staged  | Strict linting, formatting, and pre-commit hooks                        |
| **Infrastructure**     | Render, Vercel, Docker, Nginx             | Multi-stage Dockerfiles, Docker Compose, automated release migrations   |

---

## 5. Architecture

The system is architected as a **Modular Monolith** where all user interfaces communicate through identical, domain-validated services:

```mermaid
flowchart TD
    subgraph Clients["Clients & External Gateways"]
        Student["Student (WhatsApp Messenger)"]
        Browser["Admin / Counter Staff (React SPA)"]
        PublicPass["Student Pass Host (/c/:token, /pay/:token)"]
        MetaWebhook["Meta WhatsApp Cloud API"]
        RazorpayWebhook["Razorpay Webhook Service"]
    end

    subgraph Perimeter["Security & API Perimeter"]
        Nginx["Nginx Reverse Proxy / Vercel Edge"]
        RateLimiter["Rate Limiting & Helmet CSP"]
        AuthMiddleware["Session Auth & CSRF Guard"]
    end

    subgraph Backend["Modular Monolith Backend (Node.js / Express)"]
        Router["API v1 Route Handlers"]
        IntentClassifier["Gemini 2.0 Flash NLU & Intent Engine"]
        DomainServices["Core Domain Services (Single Source of Truth)\n- CouponService\n- RedemptionService\n- ReimbursementService\n- GiftService\n- MenuService"]
        Worker["Background Queue Worker (pg-boss)"]
    end

    subgraph DataStore["Persistence & Cloud Services"]
        Postgres[("PostgreSQL 16 DB\n- Prisma ORM\n- btree_gist Constraints\n- Insert-Only AuditLog")]
        S3Storage[("Private S3/R2 Bucket\n- 60s Signed URLs")]
        RazorpayAPI["Razorpay Payment Gateway"]
        WhatsAppAPI["Meta Graph API"]
        EmailProvider["Resend / Transactional Email"]
    end

    Student -->|Inbound Chat| MetaWebhook
    MetaWebhook -->|HMAC Webhook| Perimeter
    Browser -->|HTTPS Session| Perimeter
    PublicPass -->|HTTPS GET| Perimeter
    RazorpayWebhook -->|HMAC Webhook| Perimeter

    Perimeter --> RateLimiter --> AuthMiddleware --> Router
    Router --> IntentClassifier
    IntentClassifier --> DomainServices
    Router --> DomainServices

    DomainServices <-->|ACID Transactions| Postgres
    DomainServices -->|Enqueue Outbox| Worker
    DomainServices <-->|Upload / Signed URL| S3Storage

    Worker -->|Async Notification| WhatsAppAPI
    Worker -->|Async Pass Delivery| EmailProvider
    DomainServices <-->|Order Provisioning| RazorpayAPI
```

For complete technical specifications, entity models, and sequence workflows, refer to the [System Architecture Documentation](docs/ARCHITECTURE.md).

---

## 6. Getting Started

### Prerequisites

- **Node.js:** `v22.x LTS` or higher
- **Package Manager:** `npm v10.x` or higher
- **Database:** PostgreSQL `v16.x` or higher (with `btree_gist` extension enabled)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/your-org/campus-mess-system.git
cd campus-mess-system
npm install
```

### 2. Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Populate the core variables in `.env`:

```ini
# Server Configuration
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# PostgreSQL Database Connection
DATABASE_URL="postgresql://campus_admin:ChangeMeSecurely123!@localhost:5432/campus_mess?schema=public"
DEFAULT_MESS_CODE=AKSHAYA

# Security & Encryption Secrets
SESSION_SECRET="generate_64_character_hex_string_for_session_encryption"
PAYOUT_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
SUPER_ADMIN_PASSWORD="SuperAdminPassword123!"

# Google Gemini AI API
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL=gemini-2.0-flash

# Meta WhatsApp Cloud API (Optional for offline dev; mock adapters included)
WHATSAPP_PHONE_NUMBER_ID="your-phone-number-id"
WHATSAPP_ACCESS_TOKEN="your-meta-access-token"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="your-verify-token"
WHATSAPP_APP_SECRET="your-app-secret"

# Razorpay Payment Gateway (Optional for offline dev; fake adapters included)
RAZORPAY_KEY_ID="rzp_test_key"
RAZORPAY_KEY_SECRET="your-key-secret"
RAZORPAY_WEBHOOK_SECRET="your-webhook-secret"

# Email Provider
RESEND_API_KEY="your-resend-api-key"
EMAIL_FROM="mess@campus.edu"
```

### 3. Database Initialization & Seeding

```bash
# Generate Prisma Client
npm run prisma:generate

# Execute database migrations
npm run prisma:migrate

# Seed baseline data (Akshaya mess, Super Admin, policy, coupon catalog, sample students)
npm run prisma:seed
```

### 4. Running the Development Servers

Run the full-stack development environment in separate terminals:

```bash
# Terminal 1: Backend API & WhatsApp Worker Service
npm run dev --workspace=@campus-mess/backend

# Terminal 2: Frontend Administrator Web Console
npm run dev --workspace=@campus-mess/frontend
```

- **Admin Web Console:** `http://localhost:5173`
- **Default Super Admin:** `admin@campus.edu` / `SuperAdminPassword123!`
- **Backend API Base:** `http://localhost:3000/api/v1`
- **Healthcheck Probe:** `http://localhost:3000/healthz`

### 5. Running the Test Suite

The codebase includes 358 automated tests spanning unit, integration, concurrency, load, security, and smoke testing:

```bash
# Run linting, TypeScript typechecking, and tests
npm run check:all

# Run backend test suite
npm run test --workspace=@campus-mess/backend

# Run frontend test suite
npm run test --workspace=@campus-mess/frontend
```

---

## 7. Deployment

The project is fully configured for automated cloud deployment via **Render** and **Vercel**, or self-hosted via **Docker Compose**:

### Cloud Deployment (Render + Vercel)

- **Backend API & Worker (`render.yaml`):** Deploys to Render with automated pre-deploy release migrations (`npx prisma migrate deploy`) and health monitoring on `/healthz`.
- **Frontend SPA (`vercel.json`):** Deploys to Vercel Edge with immutable caching on `/assets/*` and strict `Cache-Control: no-store` on `/c/*` and `/pay/*`.

### Self-Hosted Production Docker

Run the full production stack locally or on an EC2 instance:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Post-Deployment Smoke Test

Verify production availability, security headers, and perimeter boundaries immediately after any deployment:

```bash
# Local environment
npm run smoke-test

# Remote production deployment
npx tsx scripts/smoke-test.ts https://api.campusmess.in
```

For complete deployment runbooks, secret rotation procedures, and disaster recovery drills, see [Deployment Guide](docs/DEPLOYMENT.md) and [Operational Runbook](docs/RUNBOOK.md).

---

## 8. 2-Minute Demo

| Stage            | Scenario & Flow                                                                                                                                                                                                                                                                                                                                                                                                                                             | Output & Verified Result                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Problem**      | Student wants an extra dinner coupon without waiting in cash queues; mess staff needs foolproof redemption.                                                                                                                                                                                                                                                                                                                                                 | Traditional queue avoided; zero paper waste; double redemption prevented.                        |
| **Workflow**     | **1. Student WhatsApp:** Types _"buy dinner coupon for today"_. Gemini identifies meal and replies with price and payment button.<br>**2. Razorpay Checkout:** Student opens `/pay/:orderToken`, completes simulated payment.<br>**3. Webhook Fulfillment:** Order status transitions to `PAID`; coupon generated with Crockford code `7B9K2M4P`.<br>**4. Redemption:** Counter staff scans QR or enters short code at `http://localhost:5173/redemptions`. | ✅ Instant green checkmark with chime.<br>❌ Re-scanning immediately returns `ALREADY_REDEEMED`. |
| **Rebate Claim** | **1. Absence Request:** Student texts _"calculate rebate from 10 Oct to 17 Oct"_.<br>**2. Rule Calculation:** System excludes return date, calculates 6 eligible days @ ₹131 = ₹786.00.<br>**3. Submission:** Student clicks confirmation button; draft submitted for review.<br>**4. Adjudication & Pay:** Admin approves claim with versioning guard; finance records payment UTR.<br>**5. Push Update:** Student receives WhatsApp push confirmation.    | ✅ Claim processed in compliance with university policy A1–A14 with immutable audit trail.       |

---

## 9. Future Scope (§32)

- **Onboarding Additional Dining Halls:** Natively onboard `Amrutha` (Vegetarian) and `Kamadhenu` (Central) dining halls with zero database migrations.
- **Automated Direct Payouts:** Integrate Razorpay Payouts or Cashfree for automated instant bank/UPI disbursement of approved claims.
- **AI Kitchen Demand & Wastage Analytics:** Predictive forecasting models predicting daily student turnouts based on historical attendance and menu popularity.
- **Multilingual Conversational Support:** Localized WhatsApp replies in Hindi and Telugu.
- **Mess Vendor & Supplier Portal:** Inventory procurement management and supplier delivery tracking.

---

## 10. Documentation Index

- [System Architecture](docs/ARCHITECTURE.md)
- [Operational Runbook](docs/RUNBOOK.md)
- [Administrator User Guide](docs/ADMIN_GUIDE.md)
- [Reimbursement Policy & Multi-Mess Guide](docs/POLICY_GUIDE.md)
- [REST API Reference](docs/API_REFERENCE.md)
- [Production Deployment Guide](docs/DEPLOYMENT.md)
- [Architecture Decision Records (ADRs)](docs/DECISIONS.md)
- [Phase Verification Reports (0–26)](docs/PHASE_REPORTS/)
- [Next Steps & Roadmap](docs/nextphase.md)
