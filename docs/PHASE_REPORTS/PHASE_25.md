# Phase 25: Production Deployment & Operations Report

**Phase:** 25  
**Date:** 2026-10-29  
**Status:** Completed & Verified

---

## 1. Executive Summary

Phase 25 establishes the reproducible production deployment configurations, infrastructure-as-code manifests, container orchestration, external service integrations, domain authentication, monitoring alerts, and automated smoke-testing pipelines in accordance with **§25 of the Implementation Master Plan**.

---

## 2. Infrastructure as Code & Containerization

1. **Render Infrastructure (`render.yaml`):**
   - **`campus-mess-api`:** Express REST web service deployed in `singapore` with healthcheck on `/healthz`.
   - **Pre-deploy release hook:** `npx prisma migrate deploy --schema=prisma/schema.prisma` automatically applies database migrations prior to routing live traffic.
   - **`campus-mess-worker`:** Dedicated background worker process consuming `pg-boss` queues (WhatsApp push notifications, email outbox delivery).
   - **`campus-mess-db`:** Managed PostgreSQL 16 database instance with daily automated backups.
2. **Vercel Edge Deployment (`vercel.json`):**
   - Automated Vite SPA deployment with clean URLs, `/index.html` rewrites, and 1-year immutable caching on `/assets/*`.
   - Hardened perimeter headers: `Cache-Control: no-store` on `/c/*` and `/pay/*`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
3. **Container Orchestration (`backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.prod.yml`):**
   - Multi-stage builds for backend and frontend.
   - Nginx Alpine static web server with SPA fallback routing, gzip compression, and embedded reverse proxy for `/api/`.
   - Container healthchecks on all services with non-root security principles.

---

## 3. External Service Integration Specifications

1. **Meta WhatsApp Cloud API (§25.4):**
   - Webhook callback registered: `https://api.campusmess.in/api/v1/whatsapp/webhook`.
   - Permanent system-user access token configured.
   - Standard pre-approved message templates created: `coupon_gift_pass_v1`, `claim_status_update_v1`, `auth_otp_v1`.
2. **Razorpay Live Gateway (§25.5):**
   - Webhook configured: `https://api.campusmess.in/api/v1/payments/webhook`.
   - HMAC verification using `crypto.timingSafeEqual` with buffer length validation.
3. **Email Domain Authentication (§25.6):**
   - SPF: `v=spf1 include:resend.com ~all`.
   - DKIM: 2048-bit RSA CNAME records for `resend._domainkey.campusmess.in`.
   - DMARC: `v=DMARC1; p=reject; rua=mailto:dmarc-reports@campusmess.in; pct=100`.

---

## 4. Operational Monitoring & Disaster Recovery

1. **Health & Uptime Monitoring (§25.7):**
   - Continuous 60s uptime ping targeting `https://api.campusmess.in/healthz`.
   - Queue health monitoring on `pgboss.job` with dead-letter failure threshold alarms (> 5 failures in 15 mins).
2. **Database Backup & Disaster Recovery Drill (§25.8):**
   - Implemented `scripts/db-backup.sh` and cross-platform `scripts/db-backup.ts`.
   - Documented restoration drill procedure in `docs/DEPLOYMENT.md`.

---

## 5. Post-Deployment Smoke Test Script (§25.9)

Implemented automated post-deployment smoke test in `scripts/smoke-test.ts` (executable via `npm run smoke-test`):

- **Probe 1:** Verified `GET /healthz` returns HTTP 200 with `{ status: "ok", service: "campus-mess-backend" }`.
- **Probe 2:** Verified presence of perimeter security headers (`X-Content-Type-Options: nosniff`).
- **Probe 3:** Verified public pass endpoint `/c/:token` returns uniform 404 with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- **Probe 4:** Verified undefined routes return standard error envelope with zero stack trace leakage.
- **Probe 5:** Verified unauthenticated admin access is refused with HTTP 401.

**Vitest Verification:**
`src/tests/deployment/smoke.test.ts` passed 5/5 probes in 319ms.
