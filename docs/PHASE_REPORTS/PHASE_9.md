# PHASE 9 COMPLETE: Reimbursement Calculation Engine & Claim Lifecycle

### Implemented:

- **9.1 Policy Model & Service (`backend/src/modules/reimbursements/policy.service.ts`):**
  - Immutable policy creation (`createPolicy`) ensuring previous active policy for the mess is automatically closed (`effectiveUntil = addDaysIST(effectiveFrom, -1)`).
  - Validation rejecting overlapping policies and backdating conflicts.
  - Endpoints: `GET /api/v1/reimbursement-policy` and `POST /api/v1/reimbursement-policy` (protected by `policy:manage`).
- **9.2 Authoritative Date Calculator (`backend/src/modules/reimbursements/calculator.ts`):**
  - Pure, deterministic calculation engine strictly implementing ADR A1 (`countedDays = end - start - 1`), with both departure and return days excluded.
  - Validates calendar dates, rejects inverted dates (`end <= start`), and blocks future dates (`end > today IST`).
  - Implements ADR A2: absence eligible iff `countedDays > minAbsenceDays` (default 4, so minimum 5 full counted days, `end - start >= 6`).
  - Enforces claim deadline window (`claimDeadlineDays` from return date).
  - Multi-segment per-day rate calculations supporting rate adjustments mid-absence with detailed JSON breakdown.
  - Overlap detection comparing counted day ranges against student's non-terminal claims (`[start+1, end-1]`), allowing adjacent disjoint absences (10→17 then 17→24) while rejecting true overlaps (10→17 then 15→22).
- **9.3 Claim Draft & Submission Service (`backend/src/modules/reimbursements/reimbursement.service.ts`):**
  - `saveDraft`: manages draft claim creation/updates, executes server calculation, stores encrypted payout details (`encryptPayout`), and takes student profile snapshot (`{ name, rollNo, department, messCode }`).
  - `submitClaim`: re-runs server calculation on submission, ignores any client-supplied financial amounts, and transitions from `DRAFT` to `SUBMITTED`.
  - Assigns unique public reference (`CLM-YYYY-XXXXX`).
- **9.4 Workflow State Machine & Concurrency Control (`workflow.ts`):**
  - Strict transition state machine implementing §17 (`DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED | INFO_REQUESTED -> PAYMENT_PENDING -> PAID`).
  - Optimistic locking with `version` tracking, throwing `StaleVersionError` (409) on concurrent modifications.
  - Approval rule checks: approved amount cannot exceed claimed amount; reductions require mandatory remarks.
  - Rejection checks: requires minimum 10-character reason.
  - Payment tracking: `recordPayment` supports partial payouts, enforces `OVERPAYMENT_BLOCKED`, and transitions to `PAID` when fully settled.
  - Transactional `ReimbursementStatusHistory` tracking and audit logging.

### Tests:

- Passed: 21 (12 tests in `calculator.test.ts`, 9 tests in `reimbursement.test.ts`)
- Failed: 0
- Total Project Tests: 143 passed across 25 suites (133 backend, 10 frontend)

### TypeScript:

- PASS (`tsc --noEmit` across all workspaces with 0 errors)

### Lint:

- PASS (ESLint 9 with 0 warnings, 0 errors)

### Manual Verification:

- PASS (Verified 10 Oct -> 17 Oct @ ₹131 yields exactly 6 counted days and ₹786; verified mid-period rate change segmentation, adjacent claims allowance, and version-based optimistic locking)

### Files Changed:

- `backend/src/modules/reimbursements/calculator.ts`
- `backend/src/modules/reimbursements/calculator.test.ts`
- `backend/src/modules/reimbursements/workflow.ts`
- `backend/src/modules/reimbursements/policy.service.ts`
- `backend/src/modules/reimbursements/reimbursement.schemas.ts`
- `backend/src/modules/reimbursements/reimbursement.service.ts`
- `backend/src/modules/reimbursements/reimbursement.controller.ts`
- `backend/src/modules/reimbursements/reimbursement.routes.ts`
- `backend/src/modules/reimbursements/reimbursement.test.ts`
- `backend/src/modules/reimbursements/index.ts`
- `backend/src/app.ts`
- `docs/PHASE_REPORTS/PHASE_8.md`
- `docs/PHASE_REPORTS/PHASE_9.md`

### Known Issues:

- None

### Architecture Changes:

- None

### Ready for Phase 10: YES
