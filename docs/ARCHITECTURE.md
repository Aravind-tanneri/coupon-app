# Campus Mess System — System Architecture Documentation

**Version:** 1.1.0  
**Status:** Production Ready  
**Date:** 2026-11-01

---

## 1. High-Level Architecture Overview

The **Campus Mess System** is architected as an enterprise-grade **Modular Monolith** designed for high throughput, sub-50ms counter redemptions, strict financial non-repudiation, and seamless conversational dining interactions.

It serves two primary consumer channels:

1. **Student Channel (WhatsApp + Public Pass Web):** Conversational AI interface powered by the **Meta WhatsApp Cloud API** and **Google Gemini 2.0 Flash**, coupled with token-gated public checkout (`/pay/:orderToken`) and coupon pass display (`/c/:couponToken`).
2. **Operations & Administrative Channel (React Web SPA):** Role-Based Access Control console for wardens, mess caterers, counter attendants, and finance officers.

```mermaid
flowchart TD
    subgraph Clients["1. Clients & Ingress Gateways"]
        StudentDevice["Student (WhatsApp Messenger)"]
        AdminDevice["Staff / Admin (Desktop / Tablet Browser)"]
        PublicBrowser["Student Browser (/c/:token, /pay/:token)"]
        MetaInbound["Meta Cloud Webhook Delivery"]
        RazorpayInbound["Razorpay Webhook Delivery"]
    end

    subgraph Perimeter["2. Security & Edge Layer"]
        VercelCDN["Vercel Edge Network\n- admin.campusmess.in\n- Immutable Asset Caching\n- Strict CSP & No-Store"]
        RenderEdge["Render TLS 1.3 Reverse Proxy\n- api.campusmess.in\n- /healthz Monitoring Probe"]
        RateLimiter["IP & Brute-Force Rate Limiters"]
        SecurityHeaders["Helmet HSTS, CORS & CSRF Guards"]
    end

    subgraph BackendApp["3. Core Application (Node.js 22 LTS / Express)"]
        AuthMiddleware["Session Auth & RBAC Evaluator"]
        NLUController["Gemini 2.0 Flash NLU Engine\n- Intent Classifier\n- Injected Identity Isolation"]

        subgraph DomainServices["Modular Domain Services"]
            CouponService["Coupon & Order Service"]
            RedemptionService["Redemption Service\n(Atomic State Lock)"]
            ReimbursementService["Reimbursement Service\n(A1–A14 Rules Engine)"]
            GiftService["Gift Batch Service"]
            MenuService["Menu & Broadcast Service"]
            FeedbackService["Feedback & Photo Service"]
            StorageService["Secure Storage Service\n(Magic-Byte & EXIF Stripper)"]
            AuditService["Immutable Audit Service"]
        end
    end

    subgraph AsyncWorkers["4. Asynchronous Queue Processing (pg-boss)"]
        WorkerProcess["Campus Mess Worker Process"]
        EmailOutbox["Email Outbox Queue"]
        WhatsAppOutbox["WhatsApp Outbox Queue"]
        WebhookDedupe["Webhook Ingestion & Deduplication"]
    end

    subgraph StorageEngine["5. Persistence & External APIs"]
        Postgres[("PostgreSQL 16 Engine\n- Prisma ORM\n- btree_gist Exclusion Guards\n- Insert-Only AuditLog")]
        S3Bucket[("Private Object Storage (S3 / R2)\n- 60s Presigned URLs")]
        RazorpayAPI["Razorpay Payment Gateway API"]
        MetaGraphAPI["Meta WhatsApp Graph API (v21.0)"]
        ResendAPI["Resend / SES Email API"]
        GeminiAPI["Google Gemini AI Platform"]
    end

    %% Client Ingress
    StudentDevice -->|User Messages| MetaInbound
    MetaInbound -->|HMAC POST /whatsapp/webhook| RenderEdge
    AdminDevice -->|HTTPS REST| VercelCDN
    VercelCDN -->|API Proxy /api/v1/*| RenderEdge
    PublicBrowser -->|GET /c/*, /pay/*| RenderEdge
    RazorpayInbound -->|HMAC POST /payments/webhook| RenderEdge

    %% Perimeter to Backend
    RenderEdge --> RateLimiter --> SecurityHeaders --> AuthMiddleware
    AuthMiddleware --> NLUController
    AuthMiddleware --> DomainServices
    NLUController -->|Structured Tool Call| DomainServices

    %% Domain Services to Storage & Queues
    DomainServices <-->|ACID Transactions & Row Locks| Postgres
    DomainServices <-->|Upload & Presign| S3Bucket
    DomainServices -->|Enqueue Jobs| WorkerProcess
    DomainServices <-->|Intent Inquiries| GeminiAPI
    DomainServices <-->|Create Orders| RazorpayAPI

    %% Worker Execution
    WorkerProcess <-->|Poll & Dispatch| Postgres
    WorkerProcess -->|Send Passes| ResendAPI
    WorkerProcess -->|Push Messages| MetaGraphAPI
```

---

## 2. Frontend → Backend → Database Data Flow

### 2.1 Student Extra-Meal Coupon Purchase & Real-Time Redemption Flow

This end-to-end sequence illustrates how a student purchases a coupon via WhatsApp, fulfills payment, and redeems it at the dining hall entrance with zero-double-redemption guarantees:

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student (WhatsApp)
    participant Meta as Meta WhatsApp API
    participant API as Express API (/api/v1)
    participant Gemini as Gemini 2.0 Flash
    participant Service as Coupon / Redemption Service
    participant DB as PostgreSQL 16
    participant Razorpay as Razorpay Gateway
    actor Staff as Counter Staff (Console)

    Student->>Meta: "Buy dinner coupon for today"
    Meta->>API: POST /whatsapp/webhook (HMAC verified)
    API->>Gemini: Classify intent & extract entities
    Gemini-->>API: Tool: create_coupon_order(meal: DINNER)
    API->>Service: createOrder(studentId, mealType)
    Service->>Razorpay: Create Order (amountPaise: 5000)
    Razorpay-->>Service: rzp_order_id
    Service->>DB: INSERT CouponOrder (status: CREATED)
    API->>Meta: Send Interactive Button ("Pay ₹50.00")
    Meta-->>Student: Displays Payment Button

    Student->>Razorpay: Completes UPI/Card Payment
    Razorpay->>API: POST /payments/webhook (HMAC Signature)
    API->>Service: handleWebhook(payload)
    Service->>DB: Atomic Update Order (status: PAID) & INSERT Coupon (status: ACTIVE, shortCode: "7B9K2M4P")
    API->>Meta: Send WhatsApp QR Pass & Short Code
    Meta-->>Student: Renders Pass Image & Code

    Staff->>API: POST /redemptions { shortCode: "7B9K2M4P" }
    API->>Service: redeem(shortCode, staffId, messId)
    Service->>DB: UPDATE Coupon SET status = 'REDEEMED', redeemedAt = NOW() WHERE status = 'ACTIVE' RETURNING *
    DB-->>Service: Affected 1 Row
    Service-->>Staff: 🟢 200 OK (Student Name, Meal Type, Success Chime)

    Note over Staff,Service: Duplicate Redemption Attempt
    Staff->>API: POST /redemptions { shortCode: "7B9K2M4P" }
    API->>Service: redeem(shortCode, staffId, messId)
    Service->>DB: UPDATE Coupon WHERE status = 'ACTIVE' (0 Rows matched)
    Service-->>Staff: 🔴 400 Bad Request ("COUPON_ALREADY_REDEEMED")
```

### 2.2 Student Absence Reimbursement Lifecycle Flow

```mermaid
sequenceDiagram
    autonumber
    actor Student as Student (WhatsApp)
    participant API as Express API
    participant Reimburse as ReimbursementService
    participant DB as PostgreSQL 16
    actor Warden as Mess Warden
    actor Finance as Finance Officer

    Student->>API: "Claim rebate from 10 Oct to 17 Oct"
    API->>Reimburse: calculateForStudent(10 Oct, 17 Oct)
    Reimburse->>DB: Query active Policy (₹131/day, min 4 days)
    Reimburse-->>Student: Breakdown: 6 days (departure excluded) = ₹786.00. Click to Confirm.
    Student->>API: Click Server-Nonce Submit Button
    API->>Reimburse: submitClaim(studentId, dates)
    Reimburse->>DB: Check EXCLUDE USING gist (No Overlap) & INSERT ReimbursementRequest (status: SUBMITTED)

    Warden->>API: GET /reimbursements/requests (Review Queue)
    Warden->>API: GET /reimbursements/:id/documents/:docId/url
    API->>DB: INSERT AuditLog ("DOCUMENT_VIEWED")
    API-->>Warden: 60-second temporary signed URL
    Warden->>API: PATCH /reimbursements/:id/review { status: "APPROVED", version: 1 }
    API->>Reimburse: approveClaim()
    Reimburse->>DB: UPDATE ReimbursementRequest SET status = 'APPROVED', version = 2 WHERE version = 1

    Finance->>API: POST /reimbursements/:id/pay { reference: "NEFT9876543210" }
    API->>DB: INSERT ReimbursementPayment & UPDATE status = 'PAID'
    API->>DB: Enqueue WhatsApp push notification
    DB-->>Student: Push notification: "Reimbursement of ₹786.00 credited via NEFT9876543210"
```

---

## 3. Authentication & Authorization Architecture

The platform separates administrator credentials from conversational student identities to maintain maximum security:

```mermaid
flowchart LR
    subgraph AdminAuth["Administrator Authentication (Web Portal)"]
        LoginRequest["POST /api/v1/auth/login\n- Email + Password\n- IP Rate-Limiter (5/15min)"]
        Argon2Verify["Argon2id Hash Verification\n- Salted & Peppered"]
        SessionCreate["PostgreSQL Session Record\n- SHA-256 Hashed Token\n- 8-hour Idle / 7-day Max TTL"]
        CookieDispatch["Set-Cookie: campus_session\n- HttpOnly\n- Secure\n- SameSite=Lax"]
        RBACMiddleware["requirePermission(perm)\n- SUPER_ADMIN\n- MESS_ADMIN\n- FINANCE_ADMIN\n- COUNTER_STAFF"]
    end

    subgraph StudentAuth["Student Authentication (WhatsApp)"]
        WhatsAppInbound["Inbound WhatsApp Message\n- Phone Number (E.164)"]
        RosterMatch["Match Registered Student Roster\n- Roll No / Email"]
        OTPChallenge["Generate 6-digit OTP Challenge\n- Institutional Email Delivery\n- 10-minute expiry"]
        IdentityLink["Persist WhatsAppIdentity\n- Unique E.164 binding\n- studentId Context Isolation"]
    end

    LoginRequest --> Argon2Verify --> SessionCreate --> CookieDispatch --> RBACMiddleware
    WhatsAppInbound --> RosterMatch --> OTPChallenge --> IdentityLink
```

### 3.1 Administrator Session Security

- **Hashing:** Admin passwords use **Argon2id** (`argon2.hash`).
- **Session Tokens:** Transmitted via HTTP-only, Secure, SameSite=Lax cookies. Session IDs are cryptographically hashed using SHA-256 before persisting in the `Session` table.
- **CSRF Defense:** Mutating routes (`POST`, `PATCH`, `DELETE`) require the custom header `X-Requested-With: XMLHttpRequest` alongside strict Origin/Referer header verification against `FRONTEND_URL`.
- **Cross-Mess IDOR Boundaries:** Scoped admins (`MESS_ADMIN`, `COUNTER_STAFF`) have `actorMessId` validated at both the controller parameter boundary and inside the domain service. Attempting to view documents or mutate claims belonging to another mess throws a `ForbiddenError` (HTTP 403).

### 3.2 Student Identity & Context Isolation

- Students do not use passwords. Instead, their E.164 phone number is permanently verified via institutional email OTP.
- **Prompt Injection Defense:** The `studentId` and `messId` are derived securely from server session context and **never passed as LLM arguments**. Gemini cannot access or mutate balances of other students.

---

## 4. Key APIs, Modules, & Responsibilities

The codebase follows a clean modular monolith structure under [`backend/src/modules`](file:///d:/web%20development/coupon-app/backend/src/modules):

| Module               | Core Responsibilities                                                                                                               | Key Endpoints                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **`auth`**           | Admin authentication, password hashing, session issuance, and RBAC permission evaluation.                                           | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`                                                     |
| **`coupons`**        | Extra-meal product pricing, Razorpay order provisioning, Crockford short code generation, token hashing.                            | `GET /coupons/products`, `POST /coupons/orders`, `GET /c/:token`                                            |
| **`redemptions`**    | High-speed counter scanning, coupon status verification, meal-window validation, and atomic redemption transitions.                 | `POST /redemptions/lookup`, `POST /redemptions`, `GET /redemptions/summary`                                 |
| **`reimbursements`** | Mathematical policy calculator (A1–A14), draft claim submissions, optimistic concurrency reviews, and payment logging.              | `GET /reimbursements/calculate`, `POST /reimbursements/submit`, `PATCH /reimbursements/requests/:id/review` |
| **`gifts`**          | Complimentary feast pass batch issuance, client-side idempotency deduplication, outbox multi-channel queueing, atomic revocations.  | `POST /gifts/batches`, `GET /gifts/batches/:id`, `POST /gifts/coupons/:id/revoke`                           |
| **`menus`**          | Meal slot scheduling (Breakfast, Lunch, Snacks, Dinner), dietary tagging, and emergency broadcast announcements.                    | `GET /menus/today`, `POST /menus`, `POST /menus/announcements`                                              |
| **`feedback`**       | Student meal ratings (1–5 stars), dietary category tags, WhatsApp photo attachments, and administrative review status.              | `POST /feedback`, `GET /feedback`                                                                           |
| **`whatsapp`**       | Meta webhook ingestion, raw body HMAC verification, deduplication, Gemini 2.0 Flash NLU, and conversational state routing.          | `GET /whatsapp/webhook`, `POST /whatsapp/webhook`                                                           |
| **`storage`**        | File upload validation (magic bytes, size ceilings, PDF script sanitization), private S3 key generation, and 60-second signed URLs. | `GET /reimbursements/:id/documents/:docId/url`                                                              |
| **`audit`**          | Non-repudiation audit trail recording every state change, document access, administrative login, and revocation.                    | `GET /audit`                                                                                                |

---

## 5. Database & Entity Relationship Model

The schema uses **PostgreSQL 16** with strict foreign keys, cascade protections, and index tuning:

```mermaid
erDiagram
    Mess ||--o{ AdminUser : "employs"
    Mess ||--o{ Student : "assigns"
    Mess ||--o{ Menu : "schedules"
    Mess ||--o{ CouponProduct : "sells"
    Mess ||--o{ Coupon : "issues"
    Mess ||--o{ ReimbursementPolicy : "governs"
    Mess ||--o{ ReimbursementRequest : "adjudicates"
    Mess ||--o{ GiftBatch : "sponsors"

    AdminUser ||--o{ Session : "authenticates"
    Student ||--o{ WhatsAppIdentity : "binds"
    Student ||--o{ CouponOrder : "purchases"
    Student ||--o{ Coupon : "owns"
    Student ||--o{ ReimbursementRequest : "files"
    Student ||--o{ Feedback : "submits"

    Menu ||--o{ MenuItem : "contains"
    CouponProduct ||--o{ CouponOrder : "ordered_in"
    CouponOrder ||--o| Coupon : "fulfills"
    Coupon ||--o| CouponRedemption : "redeemed_at"

    ReimbursementRequest ||--o{ ReimbursementDocument : "supports"
    ReimbursementRequest ||--o{ ReimbursementStatusHistory : "tracks"
    ReimbursementRequest ||--o{ ReimbursementPayment : "paid_by"

    GiftBatch ||--o{ GiftItem : "distributes"
    GiftItem ||--o| Coupon : "generates"

    Mess {
        string id PK
        string code UK
        string name
        boolean active
    }

    Student {
        string id PK
        string rollNo UK
        string email UK
        string name
        string department
        string messId FK
    }

    Coupon {
        string id PK
        string tokenHash UK
        string shortCode UK
        string status
        string mealType
        datetime validDate
        string studentId FK
        string messId FK
    }

    ReimbursementRequest {
        string id PK
        string publicRef UK
        date startDate
        date endDate
        int countedDays
        int claimedAmountPaise
        int approvedAmountPaise
        string status
        int version
        string studentId FK
    }

    AuditLog {
        string id PK
        string actorType
        string actorId
        string action
        string entityType
        string entityId
        json before
        json after
        datetime at
    }
```

---

## 6. External Services Integration

| Service                        | Protocol / Transport               | Purpose in System                                                                | Security & Verification                                                                          |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Meta WhatsApp Cloud API**    | HTTPS / Webhooks (Graph API v21.0) | Interactive student chat, meal pass delivery, status notifications.              | HMAC SHA-256 signature verification (`X-Hub-Signature-256`) using `crypto.timingSafeEqual`.      |
| **Google Gemini 2.0 Flash**    | REST SDK (`@google/genai`)         | Natural language understanding, intent classification, and entity extraction.    | Server-injected identity isolation; zero access to financial balance tools.                      |
| **Razorpay Payment Gateway**   | HTTPS / Webhooks                   | Processing online student payments for extra-meal coupons.                       | Raw-body HMAC verification (`X-Razorpay-Signature`), unique event deduplication (`P2002`).       |
| **Resend / Amazon SES**        | HTTPS REST / SMTP                  | Dispatching complimentary feast passes to student campus emails.                 | SPF, 2048-bit DKIM, and DMARC enforcement. Bounce webhook ingestion.                             |
| **S3 / Cloudflare R2 Storage** | AWS S3 SDK v3                      | Encrypted object storage for medical certificates and meal feedback images.      | Private bucket; randomized UUID keys; 60-second temporary presigned URLs; magic-byte validation. |
| **PostgreSQL `pg-boss`**       | PostgreSQL Native                  | Background transactional queue for outbox email dispatch and push notifications. | ACID-compliant outbox pattern; no Redis infrastructure required; exponential backoff retries.    |

---

## 7. Deployment Architecture & Production Components

The production deployment decouples edge delivery from computational backend workloads:

```mermaid
flowchart TD
    subgraph VercelEdge["Vercel Global Edge Network"]
        AdminSPA["admin.campusmess.in\n- Vite Production Build\n- Gzip & Brotli Assets\n- Immutable Asset Cache (1 Year)"]
    end

    subgraph RenderPlatform["Render Managed Cloud (Singapore Region)"]
        subgraph WebService["campus-mess-api (Web Service)"]
            NodeAPI["Express REST Server\n- Port 10000\n- Let's Encrypt TLS 1.3\n- Health Probe: /healthz"]
        end

        subgraph WorkerService["campus-mess-worker (Background Worker)"]
            QueueWorker["pg-boss Queue Consumer\n- WhatsApp Push Worker\n- Email Notification Worker"]
        end

        subgraph ManagedDB["campus-mess-db (Managed PostgreSQL 16)"]
            PostgresMaster[("PostgreSQL 16 Primary\n- Connection Pooling\n- Daily Point-in-Time Snapshots\n- 7-Day Retention")]
        end
    end

    AdminSPA -->|API Requests| NodeAPI
    NodeAPI <-->|Prisma Queries| PostgresMaster
    QueueWorker <-->|Job Queue Polling| PostgresMaster

    NodeAPI -->|Release Step Hook| Migration["npx prisma migrate deploy"]
    Migration -.->|Applies Schema Updates| PostgresMaster
```

### Production Resilience Guarantees:

1. **Automated Migration Release Step:** Prior to routing live traffic to updated containers, Render runs `prisma migrate deploy`. If a migration fails, the deployment aborts without downtime.
2. **Graceful Worker Shutdown:** Background workers trap `SIGTERM` and allow in-flight email and WhatsApp deliveries up to 10 seconds to finish before exiting.
3. **Database Backup & Restoration Drills:** Managed PostgreSQL automated snapshots combined with off-site automated gzip SQL dumps via [`scripts/db-backup.sh`](file:///d:/web%20development/coupon-app/scripts/db-backup.sh).
4. **Post-Deployment Verification:** Automated smoke testing via [`scripts/smoke-test.ts`](file:///d:/web%20development/coupon-app/scripts/smoke-test.ts) validates perimeter headers, healthcheck endpoints, and 404 error envelopes after every release.
