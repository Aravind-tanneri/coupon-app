# Production Deployment & Operations Guide (§25)

This document specifies the end-to-end production deployment, external service configurations, monitoring policies, and disaster recovery procedures for the **Campus Mess Management System**.

---

## 1. Subdomain Architecture & DNS Topology (§25.1)

| Hostname              | Target Service                | Platform                 | TLS / Certificate               |
| --------------------- | ----------------------------- | ------------------------ | ------------------------------- |
| `api.campusmess.in`   | API & WhatsApp Webhook        | Render (Singapore)       | Automated Let's Encrypt TLS 1.3 |
| `admin.campusmess.in` | Admin Management Portal       | Vercel Edge              | Automated Let's Encrypt TLS 1.3 |
| `pass.campusmess.in`  | Public Coupon Pass & Checkout | Vercel Edge / Static CDN | Automated Let's Encrypt TLS 1.3 |

---

## 2. Platform Infrastructure Architecture (§25.2, §25.3)

```
                           [ Internet Clients ]
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
   [ Vercel Edge Network ]                    [ Render Cloud (Singapore) ]
   - admin.campusmess.in                      - api.campusmess.in
   - Static React / Vite SPA                  - Express REST API / Webhooks
   - Strict CSP / no-store                    - /healthz (Health Probe)
               │                                         │
               │ API Calls (/api/v1/*)                   │
               └────────────────────┬────────────────────┘
                                    │
                       ┌────────────┴────────────┐
                       ▼                         ▼
         [ campus-mess-worker ]        [ Managed PostgreSQL 16 ]
         - pg-boss Outbox Consumer     - Primary OLTP Instance
         - Email (Resend) Worker       - Daily Automated Backups
         - WhatsApp Sender Worker      - Connection Pooling
```

### 2.1 Render Deployment (`render.yaml`)

1. Connect the GitHub repository to Render.
2. Select **New Blueprint Instance** and point to `render.yaml`.
3. The release lifecycle automatically executes:
   ```bash
   # Pre-deploy release command
   npx prisma migrate deploy --schema=prisma/schema.prisma
   ```
4. Web and Worker services build and boot independently with shared database credentials.

### 2.2 Vercel Deployment (`vercel.json`)

1. Import root repository into Vercel.
2. Framework preset: **Vite**.
3. Root directory: `.`
4. Build command: `npm run build --workspace=@campus-mess/frontend`.
5. Output directory: `frontend/dist`.
6. Environment Variable: `VITE_API_URL=https://api.campusmess.in`.

---

## 3. External Services Setup

### 3.1 Meta WhatsApp Business API (§25.4)

1. **Permanent System-User Access Token:**
   - Create a System User in Meta Business Suite with `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
   - Generate a permanent system user access token; store in `WHATSAPP_ACCESS_TOKEN`.
2. **Webhook Registration:**
   - Webhook Callback URL: `https://api.campusmess.in/api/v1/whatsapp/webhook`
   - Verify Token: Matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
   - Fields Subscribed: `messages`.
3. **Pre-Approved Message Templates:**
   - Template `coupon_gift_pass_v1`: Utility category. Prompts student with Dining Hall, occasion banner, date, and short code.
   - Template `claim_status_update_v1`: Utility category. Updates student on status changes (`APPROVED`, `PAID`, `INFO_REQUESTED`).

### 3.2 Razorpay Payment Gateway (§25.5)

1. Generate live API keys in the Razorpay Dashboard; populate `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. **Webhook Configuration:**
   - URL: `https://api.campusmess.in/api/v1/payments/webhook`
   - Secret: Store in `RAZORPAY_WEBHOOK_SECRET`.
   - Events Subscribed: `order.paid`, `payment.captured`, `payment.failed`.

### 3.3 Email Domain Authentication (§25.6)

To guarantee 100% inbox delivery for student coupon passes and admin notifications:

1. **SPF Record (DNS TXT):**
   ```text
   v=spf1 include:resend.com ~all
   ```
2. **DKIM Record (DNS CNAME):**
   - Add two 2048-bit CNAME records supplied by Resend/SES under `resend._domainkey.campusmess.in`.
3. **DMARC Policy (DNS TXT):**
   ```text
   v=DMARC1; p=reject; rua=mailto:dmarc-reports@campusmess.in; pct=100
   ```

---

## 4. Monitoring, Metrics, & Alerting (§25.7)

1. **Uptime Probes:**
   - Uptime probe pinging `https://api.campusmess.in/healthz` every 60 seconds with 5-second timeout.
   - Triggers PagerDuty / Slack alert if 2 consecutive probes fail.
2. **Dead-Letter Queue Alarms:**
   - Monitor `pgboss.job` table where `state = 'failed'`.
   - Alert threshold: > 5 failed jobs in 15 minutes.
3. **Security & Anomaly Alarms:**
   - Webhook signature mismatch spikes (> 10 invalid signatures in 5 minutes).
   - High volume of `NEEDS_REVIEW` claims requiring audit intervention.

---

## 5. Database Backup & Disaster Recovery Drill (§25.8)

### 5.1 Backup Policy

- Render Managed PostgreSQL provides automated point-in-time snapshots retained for 7 days.
- In addition, an off-site automated dump executes daily via cron:
  ```bash
  npm run db:backup
  # Or via shell:
  ./scripts/db-backup.sh /var/backups/campus_mess
  ```

### 5.2 Restoration Drill Procedure

To verify backup viability in a disaster recovery drill:

```bash
# 1. Create a clean temporary drill database
createdb campus_mess_recovery_drill

# 2. Decompress and restore the latest snapshot
gunzip -c /var/backups/campus_mess/campus_mess_20261029_000000.sql.gz | psql campus_mess_recovery_drill

# 3. Verify record counts and schema consistency
psql campus_mess_recovery_drill -c "SELECT count(*) FROM \"Student\";"
psql campus_mess_recovery_drill -c "SELECT count(*) FROM \"Coupon\";"
psql campus_mess_recovery_drill -c "SELECT count(*) FROM \"AuditLog\";"

# 4. Drop recovery drill database
dropdb campus_mess_recovery_drill
```

---

## 6. Post-Deployment Smoke Test Script (§25.9)

Run immediately following any production deployment or configuration update:

```bash
# Run against local development environment:
npm run smoke-test

# Run against live production deployment:
npx tsx scripts/smoke-test.ts https://api.campusmess.in
```

### Probes Executed:

1. `GET /healthz` returns HTTP 200 with `{ status: "ok", service: "campus-mess-backend" }`.
2. HTTP perimeter enforces `X-Content-Type-Options: nosniff` and HSTS.
3. Public pass endpoint `GET /c/:unknownToken` returns uniform 404 with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
4. Undefined API routes return uniform standard error envelope without stack traces or DB leakage.
5. Protected admin endpoints refuse unauthenticated callers with HTTP 401.
