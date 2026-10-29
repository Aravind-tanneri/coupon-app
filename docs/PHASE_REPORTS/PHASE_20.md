# Phase 20 Report: Admin Gift Coupons

## Headline Implementation Verification

- **Gift Batch Issuance Service (§19, §20.1):**
  - Implemented transactional batch engine in `GiftService.issueBatch`.
  - Student list deduplication on incoming array (`Array.from(new Set(studentIds))`).
  - Strict calendar date enforcement ensuring meal dates cannot be set in the past (`mealDate >= todayIST`).
  - Partial unique index & duplication guard: dynamically skips students who already hold an active, non-revoked gift coupon for that date and `SPECIAL_DINNER` meal type.
  - Outbox pattern integration (§20): automatically enqueues notification rows for email and WhatsApp delivery (`NotificationStatus.PENDING`).
  - Batch summary return payload detailing `totalRequested`, `issued`, `skippedDuplicate`, and `failed`.
- **Domain & Request Idempotency (§19, §30):**
  - Mandatory unique constraint on `GiftBatch.idempotencyKey`.
  - When a batch request is retried with an existing `idempotencyKey`, `GiftService` returns the original batch summary without re-issuing duplicate coupons or creating conflicting records.
  - Manual verification requirement (§30: "Issue a batch twice with the same key"): Verified via unit tests and automated route tests.
- **Atomic Coupon Revocation with Race Guard (§19, §20.4):**
  - Atomic `updateMany` condition: `UPDATE Coupon SET status='REVOKED', revokedAt=now(), revokedById=adminId WHERE id=couponId AND status='ACTIVE'`.
  - Concurrency guard: If atomic update count is 0, status is evaluated. If coupon was redeemed at the counter concurrently, revocation is strictly refused with `ConflictError("Cannot revoke an already redeemed coupon", "CANNOT_REVOKE_REDEEMED")`.
- **Gift Administration API (§20.2):**
  - `POST /api/v1/gifts`: `requirePermission('gift:issue')`, request deduplication, transactional issuance.
  - `GET /api/v1/gifts`: `requirePermission('gift:view')`, paginated list with real-time aggregated counts (`active`, `redeemed`, `revoked`).
  - `GET /api/v1/gifts/:id`: `requirePermission('gift:view')`, batch details enriched with student profile and coupon redemption status.
  - `POST /api/v1/gifts/coupons/:couponId/revoke`: `requirePermission('gift:revoke')`, atomic revocation.
  - `POST /api/v1/gifts/:id/resend`: `requirePermission('gift:resend')`, enqueues alerts for failed/pending deliveries without touching coupons.
- **Admin Gift Dashboard UI (§20.3, §20.5):**
  - `frontend/src/pages/GiftsPage.tsx`:
    - Top summary metrics (Total Batches, Total Issued, Active, Redeemed, Revoked).
    - Modal for issuing gift batches with date picker, occasion note, and searchable student multi-select.
    - Live batch preview summary with selected recipient counter (capped at 300 per §19).
    - Post-issuance result dialog highlighting `issued`, `skippedDuplicate`, and `failed`.
    - Batches data table showing redemption status breakdown pills (`Active`, `Redeemed`, `Revoked`).
    - Student roster details modal displaying student profile, coupon short codes, redemption timestamps, and atomic revocation triggers.
    - Resend notification modal supporting channel filtering (All, Email, WhatsApp).

## Verification

- Backend Suite: `backend/src/modules/gifts/gift.test.ts` (10/10 passing).
- Frontend Suite: `frontend/src/pages/GiftsPage.test.tsx` (3/3 passing).
- Full Verification: `npm run check:all` (40 test files, 303 tests passing, zero TypeScript/ESLint warnings).

### Ready for Phase 21: YES
