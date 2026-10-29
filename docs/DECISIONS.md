# Architecture Decision Records (ADRs)

This document records the foundational architecture and business decisions for the Campus Mess System.

---

## Seed Decisions (§0)

### ADR A1: Day Counting Formula

- **Context:** Students claiming mess fee reimbursement for extended absences need a deterministic, indisputable calculation for counted days.
- **Decision:** Counted days are strictly calculated as:
  $$\text{Counted Days} = \text{end} - \text{start} - 1$$
  Both the departure date and return date are excluded as partial consumption days.
- **Example:** Departure 10 Oct, Return 17 Oct:
  Counted days = $17 - 10 - 1 = 6$ days (11 Oct through 16 Oct). At ₹131/day = **₹786**.
- **Rule:** No configurable `dayCountMode` setting exists. All calendar days within the mess operational period count.

---

### ADR A2: Minimum Absence Threshold ("More than 4 days")

- **Context:** Eligibility rule requires students to be away for "more than 4 days".
- **Decision:** A claim is eligible if and only if $\text{countedDays} > \text{minAbsenceDays}$ (where default `minAbsenceDays` = 4).
- **Rule:** To be eligible, $\text{countedDays} \ge 5$, which requires $\text{end} - \text{start} \ge 6$.

---

### ADR A3: Weekends and Holidays

- **Context:** Mess operations run continuously throughout the academic term.
- **Decision:** All calendar days within the absence window count. The mess operates daily; no per-meal partial days or weekend exclusions exist in v1.

---

### ADR A4: Multiple Absence Claims & Overlaps

- **Context:** A student may have multiple absence periods during a semester.
- **Decision:** A student may submit multiple claims provided their counted-day ranges do not overlap.
- **Rule:** Claim $A$ (10 Oct $\to$ 17 Oct, counted `[11, 17)`) and Claim $B$ (17 Oct $\to$ 24 Oct, counted `[18, 24)`) are disjoint and allowed. A claim that is rejected or cancelled releases its dates.

---

### ADR A5: Claim Timing and Future Dates

- **Context:** Preventing speculative or fraudulent pre-absence claims.
- **Decision:** `endDate <= today (IST)` is strictly enforced on submission. Future claims are rejected.
- **Rule:** Submission window is constrained by `claimDeadlineDays` (default 30 days after return; 0 = disabled).

---

### ADR A6: Mid-Absence Rate Changes

- **Context:** Daily reimbursement rates may change across policy cycles or academic terms.
- **Decision:** The per-day reimbursement rate is resolved dynamically from the policy active on each individual counted day.
- **Rule:** The claim stores the computed sum and an immutable JSON breakdown of date segments.

---

### ADR A7: Multi-Mess Architecture with Single Live Mess

- **Context:** Campus contains three messes: Akshaya, Amrutha, and Kamadhenu.
- **Decision:** The database schema is multi-mess from day one (`messId` foreign keys on all relevant models).
- **Rule:** Only `AKSHAYA` is seeded and live in v1. Admin UI does not present a mess selector in v1.

---

### ADR A8: Student Identity Verification via Roster

- **Context:** Authenticating student WhatsApp numbers without requiring passwords on WhatsApp.
- **Decision:** Admin uploads an institutional CSV roster (`rollNo, name, email, department, mess?`).
- **Rule:** Linking requires matching a roster roll number followed by an OTP sent to the verified institutional email. A phone number cannot be linked to multiple active students.

---

### ADR A9: Redemption Verification Role

- **Context:** Ensuring physical coupon presentation matches the rightful student.
- **Decision:** Role `MESS_STAFF` operates the counter scanner (`/admin/redeem`).
- **Rule:** Staff visually confirm the student's name and roll number displayed on the preview screen before triggering the atomic redemption confirmation.

---

### ADR A10: Pseudonymous Feedback

- **Context:** Encouraging honest student feedback while preventing abuse.
- **Decision:** Anonymous feedback is toggled via `allowAnonymousFeedback` (default false). When enabled, admin APIs and UIs redact student identity. The database retains student association for abuse moderation (pseudonymous, not completely anonymous).

---

### ADR A11: Refunds

- **Context:** Handling unused or cancelled coupons.
- **Decision:** Automated customer refunds are out of scope for v1. Admins may manually record refund notes.

---

### ADR A12: Reimbursement Payouts

- **Context:** Disbursing approved reimbursement funds.
- **Decision:** Payouts occur externally (institutional bank transfer / UPI). Admins record external transaction references in the system. Automated bank disbursements are out of scope for v1.

---

### ADR A13: Hostel Information

- **Context:** Mess management vs hostel management boundary.
- **Decision:** No hostel fields exist anywhere in the schema. The student's assigned mess replaces all accommodation routing.

---

### ADR A14: Payment Gateway

- **Context:** Purchasing extra-meal coupons.
- **Decision:** Razorpay is the primary gateway for v1 using a single institutional account. The webhook (`order.paid`) is the authoritative source of truth for issuing coupons.

---

## Architectural Trade-Offs (§33)

| Decision                | Chosen                                                        | Rejected                      | Rationale                                                                                                                |
| ----------------------- | ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **App Topology**        | Modular monolith + Express                                    | Microservices                 | Eliminates multi-service deployment complexity, network hops, and distributed transaction issues for ~100 msgs/min.      |
| **Job Queue**           | `pg-boss` (Postgres)                                          | Redis + BullMQ                | Avoids introducing and managing a second stateful caching infrastructure; transaction-safe with Postgres.                |
| **LLM Scope**           | Gemini for NLU + Tool selection                               | Fully LLM-driven dialog       | Guarantees deterministic financial amounts, eliminates hallucinated rates, prevents prompt injection into balances.      |
| **Confirmation**        | Server-issued signed nonce buttons                            | Typed text ("yes/confirm")    | Prevents accidental, replayed, or spoofed financial submissions.                                                         |
| **Coupon Issuance**     | Post-payment creation                                         | Pre-payment draft rows        | Eliminates unpaid zombie rows and mid-state race conditions.                                                             |
| **Admin Auth**          | Server-side sessions (PostgreSQL)                             | JWT in localStorage           | Enables instantaneous session revocation upon password reset; immune to localStorage XSS token theft.                    |
| **Overlap Guard**       | PostgreSQL exclusion constraint (`EXCLUDE USING gist`)        | Application-level check only  | Prevents concurrent race conditions where two simultaneous requests submit overlapping absence dates.                    |
| **Audit Logs**          | Insert-only tables (`AuditLog`, `ReimbursementStatusHistory`) | Mutable audit logs            | Guarantees non-repudiation and tamper resistance for financial operations.                                               |
| **Cross-Mess IDOR**     | Service & controller dual-layer boundaries                    | Controller-only validation    | Guarantees mess isolation at both API perimeter and inner service layer; prevents cross-mess document or claim mutation. |
| **Token Privacy**       | Uniform 404 & zero PII in public coupon pass                  | Full student details returned | Prevents student enumeration, identity leaks, or data scraping via `/c/:token`.                                          |
| **Deployment Topology** | Render API + Worker + Postgres & Vercel Edge SPA              | Monolithic unmonitored VM     | Decoupled horizontal scaling of web requests vs asynchronous workers; automated migration verification before traffic.   |
