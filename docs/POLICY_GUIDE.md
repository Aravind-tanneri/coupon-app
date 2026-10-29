# Campus Mess System — Reimbursement Policy & Multi-Mess Configuration (§26.3)

**Version:** 1.0.0  
**Scope:** Policy Parameters A1–A14 Reference, Immutability Guarantees, Multi-Mess Onboarding

---

## 1. Reimbursement Policy Parameters Reference (A1–A14)

Reimbursement calculations are governed by strict mathematical rules defined in `ReimbursementPolicy`. Values are stored in integer paise.

| Code    | Parameter Name             | Canonical Setting (Akshaya) | Unit / Format    | Rule Enforcement Description                                                               |
| ------- | -------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| **A1**  | Daily Rebate Rate          | `₹131.00` (13100 paise)     | Integer Paise    | Base compensation credited per approved absence day.                                       |
| **A2**  | Minimum Absence Duration   | `3` Days                    | Integer Days     | Absences shorter than 3 consecutive calendar days are ineligible for rebate.               |
| **A3**  | Maximum Days Per Term      | `15` Days                   | Integer Days     | Maximum cumulative absence days reimbursable per student per semester.                     |
| **A4**  | Prior Notice Period        | `2` Days                    | Integer Days     | Number of days before departure that advance notice must be submitted.                     |
| **A5**  | Retroactive Filing Window  | `7` Days                    | Integer Days     | Maximum number of days allowed to submit a claim after returning to campus.                |
| **A6**  | Mandatory Document Ceiling | `5` Days                    | Integer Days     | Absences exceeding 5 consecutive days require verified proof (medical/leave slip).         |
| **A7**  | Boundary Calculation Rule  | `Exclusive` (End - Start)   | Date IST         | Start date counts as absence; Return date counts as presence (e.g. 10 to 17 Oct = 6 days). |
| **A8**  | Consecutive Day Continuity | `Strict Calendar`           | ISO 8601         | Dates must form a contiguous uninterrupted range. Disjoint trips must be filed separately. |
| **A9**  | Overlapping Claim Guard    | `EXCLUDE USING gist`        | PostgreSQL Range | Overlapping absence ranges for the same student are blocked at the database level.         |
| **A10** | Consecutive Trip Joining   | `Allowed`                   | Date Logic       | Consecutive back-to-back claims (e.g. 10–17 Oct followed by 17–24 Oct) are accepted.       |
| **A11** | Minimum Daily Attendance   | `1` Meal Presence           | Boolean          | Consuming any meal on an absence date forfeits rebate for that day.                        |
| **A12** | Exam / Vacation Waiver     | `Configurable`              | Boolean          | Term break periods bypass the A4 prior notice requirement.                                 |
| **A13** | Currency Precision         | `Paise Integer`             | INR Paise        | Arithmetic is performed without floating-point rounding errors.                            |
| **A14** | Optimistic Version Guard   | `Integer Increment`         | Concurrency      | Concurrent review actions verify version; rejects stale overwrites with HTTP 409.          |

---

## 2. Policy Versioning & Immutability Architecture

> [!IMPORTANT]
> Policies in the Campus Mess system are strictly **append-only**. Existing policy rows are never modified in place.

### Why Immutability Matters:

- When a student files a claim, the current active `policyId` and daily rate are frozen onto the claim record.
- If the administration adjusts the daily rate from ₹131 to ₹145 next semester:
  1. A new `ReimbursementPolicy` record is inserted with `effectiveFrom = nextSemesterDate`.
  2. The previous policy record is deactivated (`isActive = false`).
  3. All historical claims retain their snapshot calculations and exact payout amounts without retroactive alteration or audit discrepancies.

---

## 3. Multi-Mess Onboarding Guide (Amrutha & Kamadhenu)

The database schema is natively multi-tenant via `messId` foreign keys on all operational models. Onboarding additional campus dining halls requires **zero schema migrations**.

### Step 1: Insert New Dining Hall Records

```sql
INSERT INTO "Mess" ("id", "code", "name", "isActive", "createdAt", "updatedAt")
VALUES
  ('mess-amrutha-01', 'AMRUTHA', 'Amrutha Vegetarian Dining Hall', true, NOW(), NOW()),
  ('mess-kamadhenu-01', 'KAMADHENU', 'Kamadhenu Central Dining Hall', true, NOW(), NOW());
```

### Step 2: Configure Mess-Specific Policy

Each dining hall can specify its own customized rebate rates and meal schedules:

```sql
INSERT INTO "ReimbursementPolicy" (
  "id", "messId", "dailyRatePaise", "minConsecutiveDays", "maxDaysPerMonth",
  "noticePeriodDays", "requiresProofAboveDays", "version", "isActive", "createdAt"
) VALUES (
  'pol-amrutha-v1', 'mess-amrutha-01', 13100, 3, 15, 2, 5, 1, true, NOW()
);
```

### Step 3: Populate Meal Windows

Configure meal timings in the `Setting` table:

```json
{
  "BREAKFAST": { "start": "07:30", "end": "09:30" },
  "LUNCH": { "start": "12:00", "end": "14:15" },
  "SNACKS": { "start": "16:30", "end": "18:00" },
  "DINNER": { "start": "19:30", "end": "21:30" }
}
```

### Step 4: Provision Staff & Roster

1. Create `AdminUser` accounts with role `MESS_ADMIN` or `COUNTER_STAFF` bound to `messId: 'mess-amrutha-01'`.
2. Upload the student roster mapping students to their designated dining hall.
3. Mess admins immediately see their isolated console with strict cross-mess boundary isolation.
