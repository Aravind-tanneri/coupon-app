# Campus Mess Management System — API Reference Specification (§26.4)

**Base URL:** `https://api.campusmess.in/api/v1`  
**Protocol:** HTTPS / TLS 1.3  
**Content-Type:** `application/json` (except webhook raw payloads)

---

## 1. Response Formats & Error Envelopes

### 1.1 Success Response Envelope

```json
{
  "success": true,
  "data": { ... }
}
```

### 1.2 Standard Error Response Envelope

```json
{
  "error": {
    "code": "UNAUTHORIZED | NOT_FOUND | BUSINESS_RULE_ERROR | STALE_VERSION | TOO_MANY_REQUESTS",
    "message": "Human-readable explanation of the refusal condition",
    "details": {},
    "requestId": "req_cuid1234567890"
  }
}
```

---

## 2. Authentication & Authorization

| Authentication Scheme  | Header / Transport                  | Applied Routes                                    |
| ---------------------- | ----------------------------------- | ------------------------------------------------- |
| **Server Session**     | `Cookie: campus_session=<id>`       | Admin portal routes (`/admin/*`, `/api/v1/*`)     |
| **CSRF Token Guard**   | `X-Requested-With: XMLHttpRequest`  | All mutating requests (`POST`, `PATCH`, `DELETE`) |
| **Razorpay HMAC**      | `X-Razorpay-Signature: <hex>`       | Payment webhooks (`/api/v1/payments/webhook`)     |
| **Meta Hub Signature** | `X-Hub-Signature-256: sha256=<hex>` | WhatsApp webhooks (`/api/v1/whatsapp/webhook`)    |
| **Public Token Pass**  | URL Path parameter (128-bit)        | Public coupon QR display (`/c/:token`)            |

---

## 3. API Endpoints Directory

### 3.1 Authentication (`/auth`)

- **`POST /api/v1/auth/login`**
  - **Auth:** Public (Rate-limited: 5 attempts per 15 mins per IP + account).
  - **Body:** `{ "email": "admin@campus.edu", "password": "..." }`
  - **Response (200):** Sets HTTP-only `campus_session` cookie; returns `{ "user": { "id", "email", "role", "messId" } }`.
- **`POST /api/v1/auth/logout`**
  - **Auth:** Required. Destroys server-side session in PostgreSQL.
- **`GET /api/v1/auth/me`**
  - **Auth:** Required. Returns currently authenticated administrator session profile.

### 3.2 Menus & Announcements (`/menus`)

- **`GET /api/v1/menus/today`**
  - **Query:** `messId` (optional). Returns breakfast, lunch, snacks, and dinner dish items for today IST.
- **`GET /api/v1/menus/weekly`**
  - **Query:** `messId`, `startDate`, `endDate`.
- **`POST /api/v1/menus`**
  - **Permission:** `menu:manage`. Creates or updates daily menu slots.
- **`POST /api/v1/menus/announcements`**
  - **Permission:** `announcement:create`. Publishes emergency broadcast announcement.

### 3.3 Coupons & Payments (`/coupons`, `/payments`)

- **`GET /api/v1/coupons/products`**
  - **Public / Student.** Lists active purchasable coupon products for a dining hall.
- **`POST /api/v1/coupons/orders`**
  - **Public / Student.** Creates a coupon order and provisions a Razorpay order in paise.
- **`POST /api/v1/coupons/verify-payment`**
  - **Public / Student.** Verifies client Razorpay checkout signature and fulfills coupon issuance.
- **`POST /api/v1/coupons/webhook`**
  - **Webhook.** Verifies Razorpay raw body HMAC signature; fulfills order idempotently.
- **`GET /c/:token`**
  - **Public Pass Display.** Rate-limited by IP. Uniform 404 on missing token.
  - **Response (200):** Safe non-PII presentation:
    ```json
    {
      "success": true,
      "data": {
        "shortCode": "7B9K2M4P",
        "messName": "Akshaya Dining Hall",
        "occasion": "Special Sunday Feast",
        "mealDate": "2026-11-01",
        "mealType": "DINNER",
        "status": "ACTIVE",
        "expiresAt": "2026-11-01T16:00:00.000Z"
      }
    }
    ```
- **`POST /api/v1/coupons/:id/revoke`**
  - **Permission:** `coupon:revoke`. Revokes active coupon before redemption.

### 3.4 Redemption Scanner (`/redemptions`)

- **`POST /api/v1/redemptions/lookup`**
  - **Permission:** `redemption:scan`.
  - **Body:** `{ "shortCode": "7B9K2M4P" }` or `{ "token": "..." }`.
  - **Response (200):** Validates coupon active status and current meal window eligibility.
- **`POST /api/v1/redemptions`**
  - **Permission:** `redemption:scan`. Executes atomic state transition `ACTIVE -> REDEEMED`.
  - Refuses double redemption with HTTP 400 (`COUPON_ALREADY_REDEEMED`).
- **`GET /api/v1/redemptions/summary`**
  - **Permission:** `redemption:view`. Daily redemption count metrics by meal type.

### 3.5 Reimbursements (`/reimbursements`)

- **`GET /api/v1/reimbursements/calculate`**
  - **Query:** `studentId`, `startDate`, `endDate`.
  - Computes eligible consecutive days, excludes departure date, applies A1 rate, checks term limits.
- **`POST /api/v1/reimbursements/draft`**
  - Upserts draft claim for student.
- **`POST /api/v1/reimbursements/submit`**
  - Submits draft claim, checks overlap constraint, locks version, notifies admin.
- **`GET /api/v1/reimbursements/requests`**
  - **Permission:** `reimbursement:view`. Server-side filtered claims list.
- **`PATCH /api/v1/reimbursements/requests/:id/review`**
  - **Permission:** `reimbursement:review`.
  - **Body:** `{ "status": "APPROVED | REJECTED | INFO_REQUESTED", "version": 1, "remarks": "..." }`.
  - Optimistic concurrency check: fails with HTTP 409 `STALE_VERSION` if claim was updated concurrently.
- **`POST /api/v1/reimbursements/requests/:id/pay`**
  - **Permission:** `reimbursement:pay`. Records UTR number and marks claim `PAID`.
- **`GET /api/v1/reimbursements/:id/documents/:docId/url`**
  - **Permission:** `reimbursement:view`. Generates 60-second temporary signed URL and records audit log.

### 3.6 Special-Dinner Feast Gifting (`/gifts`)

- **`POST /api/v1/gifts/batches`**
  - **Permission:** `gift:manage`.
  - **Header:** `Idempotency-Key: <uuid>`.
  - **Body:** `{ "messId", "mealDate", "studentIds": [...], "message": "..." }`.
  - Issues gift passes and enqueues WhatsApp and email outbox notifications.
- **`GET /api/v1/gifts/batches`**
  - **Permission:** `gift:view`. Lists gift batches with pagination.
- **`GET /api/v1/gifts/batches/:id`**
  - **Permission:** `gift:view`. Detailed recipient roster, delivery statuses, and short codes.
- **`POST /api/v1/gifts/coupons/:couponId/revoke`**
  - **Permission:** `gift:manage`. Atomically revokes gift pass if unredeemed.

### 3.7 Meta WhatsApp Inbound Webhook (`/whatsapp`)

- **`GET /api/v1/whatsapp/webhook`**
  - Verifies hub challenge and subscription mode.
- **`POST /api/v1/whatsapp/webhook`**
  - Ingests incoming WhatsApp messages, validates HMAC signature, deduplicates message ID, and enqueues worker conversation processing.
