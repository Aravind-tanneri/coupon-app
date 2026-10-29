# Campus Mess Management System — Operational Runbook (§26.1)

**Version:** 1.0.0  
**Target Audience:** DevOps Engineers, System Administrators, On-Call Engineers  
**Scope:** Production Deployment, Emergency Operations, Secrets Rotation, Webhook Incident Recovery

---

## 1. Routine Deployment & Release Lifecycle

The system utilizes Render Infrastructure-as-Code (`render.yaml`) and Vercel Edge (`vercel.json`).

### 1.1 Automated Deployment Flow

1. Code merged to the `main` branch triggers pre-commit tests, linting, and typecheck.
2. Render detects changes on `main` and runs the pre-deploy release hook:
   ```bash
   npx prisma migrate deploy --schema=prisma/schema.prisma
   ```
3. Upon zero migration errors, Render deploys the updated `campus-mess-api` web container and `campus-mess-worker` worker container.
4. Vercel automatically compiles and invalidates the edge CDN cache for `admin.campusmess.in`.

### 1.2 Post-Deploy Smoke Verification

Execute the automated post-deployment probe immediately after release:

```bash
npx tsx scripts/smoke-test.ts https://api.campusmess.in
```

Ensure all 5 probes pass.

---

## 2. Emergency Rollback Procedure

If critical regressions or unexpected errors occur post-deploy:

### 2.1 Git Rollback

```bash
# 1. Identify previous stable commit hash
git log -n 5 --oneline

# 2. Revert the commit or checkout previous release tag
git revert <faulty_commit_hash> -m 1
git push origin main
```

### 2.2 Database Migration Rollback

If a database migration caused issues:

> [!CAUTION]
> Never execute `prisma migrate reset` in production. Always roll forward with a safe corrective migration.

1. Inspect the migration status:
   ```bash
   npx prisma migrate status --schema=prisma/schema.prisma
   ```
2. Create a corrective migration:
   ```bash
   npx prisma migrate dev --name rollback_feature --schema=prisma/schema.prisma
   ```
3. Commit and push to trigger automated deployment.

---

## 3. Secrets Rotation Procedures

### 3.1 Session Secret (`SESSION_SECRET`)

Rotates the signing key for Express HTTP-only session cookies.

- **Impact:** All active admin users will be logged out and required to sign in again. No student WhatsApp flows are disrupted.
- **Procedure:**
  1. Generate a high-entropy 64-character secret:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
  2. Update `SESSION_SECRET` in the Render Environment Dashboard.
  3. Trigger redeployment of `campus-mess-api`.

### 3.2 Payout Encryption Key (`PAYOUT_ENCRYPTION_KEY`)

Used for AES-256-GCM symmetric encryption of student bank account and UPI details at rest.

- **Key Format:** Exactly 64 hex characters (32 bytes).
- **Graceful Rotation Procedure:**
  1. Generate new 32-byte hex key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  2. Export `PAYOUT_ENCRYPTION_KEY_NEW` alongside the existing `PAYOUT_ENCRYPTION_KEY`.
  3. Run batch re-encryption script against existing `Student` rows in PostgreSQL.
  4. Swap `PAYOUT_ENCRYPTION_KEY` to the new key and delete the old key.

### 3.3 Razorpay & Meta WhatsApp Webhook Secrets

- **Razorpay Webhook Secret:** Update secret in Razorpay Dashboard > Settings > Webhooks, then immediately update `RAZORPAY_WEBHOOK_SECRET` on Render.
- **Meta WhatsApp Access Token:**
  1. Open Meta Business Suite > System Users.
  2. Generate new permanent access token for the designated system user.
  3. Update `WHATSAPP_ACCESS_TOKEN` on Render.

---

## 4. Webhook Incident Recovery & Replay

### 4.1 Replaying a Razorpay Webhook

If a network timeout or downtime caused a dropped webhook event:

1. Log into Razorpay Dashboard > **Settings** > **Webhooks**.
2. Locate the failed webhook event by Order ID / Payment ID.
3. Click **Resend Event**.
4. The backend deduplication layer (`model WebhookEvent`) ensures:
   - If previously unprocessed, the payment verifies and the coupon issues atomically.
   - If previously processed, the unique constraint (`provider`, `eventId`) cleanly deduplicates without duplicate coupon creation.

### 4.2 Replaying WhatsApp Inbound Messages

Meta Cloud API automatically retries dropped webhooks up to 7 days with exponential backoff.
To view delivery status or unblock backlogged queues:

```sql
-- Check failed jobs in pg-boss
SELECT id, name, state, output, createdon
FROM pgboss.job
WHERE state = 'failed'
ORDER BY createdon DESC
LIMIT 20;
```

To retry failed jobs in `pg-boss`:

```sql
UPDATE pgboss.job
SET state = 'retry', retrycount = 0
WHERE state = 'failed' AND name = 'notifications:whatsapp';
```

---

## 5. Student Account & Identity Link Reset

If a student changes their phone number or loses access to their WhatsApp account:

### 5.1 Procedure to Relink Student Phone:

1. Admin opens **Students** page on `admin.campusmess.in`.
2. Locate the student by Roll Number (e.g. `2024CS001`).
3. Click **Reset Phone Link** (requires `student:manage` permission).
4. The system:
   - Clears `phone` and `phoneLinkedAt` on the student record.
   - Revokes any outstanding OTP nonces.
   - Logs an audit entry: `STUDENT_PHONE_UNLINKED`.
5. Student sends `"Hi"` to the WhatsApp bot from their new number and completes 6-digit OTP verification.

---

## 6. Mess Counter Emergency Offline Fallback

If the mess counter loses Internet connectivity during meal rush:

1. **Physical Backup Ledger:** Counter staff maintain a printed or offline-cached student roster for the day's special meal.
2. **Offline Short Code Verification:** Students present their 8-character Crockford base32 short code (e.g., `7B9K2M4P`) or cached WhatsApp pass.
3. Staff note down short codes manually.
4. When connectivity resumes:
   - Counter staff open `admin.campusmess.in/redemptions`.
   - Enter accumulated short codes sequentially or scan barcode/QR.
   - System records timestamped redemption and prevents double use.
