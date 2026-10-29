# Phase 16 Report: WhatsApp Reimbursement Workflow

## Headline Workflow Verification

- **Multi-Step Guided Wizard (§9, §16.1):** Structured conversational state machine persisted in `Conversation` table with version increment and 30-minute idle expiry.
  `AWAITING_START_DATE → AWAITING_END_DATE → SHOW_CALCULATION → AWAITING_REASON → AWAITING_PAYOUT_DETAILS → AWAITING_CONFIRMATION → SUBMITTED`.
- **Deterministic Date Parsing (§16.2):** `parseUserDateInput` parses ISO (`YYYY-MM-DD`), numeric (`10/10/2026`, `10-10`), and textual (`10 Oct`, `10 October 2026`) formats into validated IST dates, safely rejecting calendar errors (e.g. 31 Feb).
- **Authoritative Server Calculation (§3, §16.3):** Displays calculation template (`Away`, `Days counted`, `Rate/day`, `Estimated claim`) directly from `ReimbursementService.calculateForStudent`. Clear rejection wording when ineligible.
- **Review Screen & Anti-Prompt-Injection Submission (§16.5):**
  - Displays review screen with masked payout details and student/mess context.
  - Server issues single-use cryptographic submission nonce `submit:<nonce>`.
  - **CRITICAL AC:** A typed "yes" or "submit" does NOT submit the claim. Final submission is only processed via the router when the button carrying the nonce is clicked.
  - Stale, expired, or replayed nonces are rejected.
- **My Claims & Info Request Highlights (§16.6):** Formats recent claims with statuses and surfaces admin info request remarks for action.

## Security Verification

1. **Financial Calculation Protection:** No client or LLM supplied amounts or day counts are accepted; recalculated on server at draft and submission time.
2. **PII Protection:** Payout details (UPI/bank account) are encrypted at rest with AES-256-GCM and masked (`****axis`) in WhatsApp prompts.
3. **Identity Isolation:** All workflow operations are strictly scoped to the student linked to the WhatsApp identity.

## Verification

- Unit & Workflow Suite: `backend/src/modules/whatsapp/workflows/reimbursement.test.ts` (13/13 passing).
- Date Parser Suite: `backend/src/lib/dates-ist.test.ts` (11/11 passing).
- Full Verification: `npm run check:all` (35 test files, 261 tests passing, zero TypeScript/ESLint warnings).
