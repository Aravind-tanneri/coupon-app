# WhatsApp Meta Pre-Approved Template Registry

Under Meta WhatsApp Cloud API policies, initiating conversations or sending outbound messages after the 24-hour customer service window closes requires pre-approved message templates.

The following templates are registered for the Campus Mess Management System:

---

### 1. Reimbursement Status Update (`reimbursement_status_update`)

- **Category:** `UTILITY`
- **Language:** `en`
- **Use Case:** Triggered by Phase 10 administrative review/payment transitions to alert students.
- **Body Template:**
  > Hello {{1}}, your mess reimbursement claim {{2}} has been updated to: _{{3}}_. Note: {{4}}. Reply to this message to view full details or query our assistant.
- **Variables:**
  - `{{1}}`: Student First Name (e.g., `Rahul`)
  - `{{2}}`: Public Claim Reference (e.g., `CLM-2026-00042`)
  - `{{3}}`: Status (e.g., `APPROVED`, `PAID`, `INFO_REQUESTED`)
  - `{{4}}`: Remarks / Approved Amount (e.g., `₹786 credited to bank account` or `Please upload train ticket`)

---

### 2. Coupon Ready (`coupon_ready`)

- **Category:** `UTILITY`
- **Language:** `en`
- **Use Case:** Sent immediately after successful Razorpay payment verification with the coupon pickup code.
- **Body Template:**
  > Hello {{1}}, your coupon for _{{2}}_ on _{{3}}_ is confirmed! Your counter code is _{{4}}_. Present this code or tap below to show your QR pass.
- **Variables:**
  - `{{1}}`: Student Name
  - `{{2}}`: Meal Type (e.g., `LUNCH`)
  - `{{3}}`: Date (e.g., `15 Oct 2026`)
  - `{{4}}`: Short Code (e.g., `CPN-7892`)

---

### 3. Special Dinner Gift Notification (`special_dinner_gift`)

- **Category:** `UTILITY`
- **Language:** `en`
- **Use Case:** Sent when admin issues a special dinner gift batch to students.
- **Body Template:**
  > Hello {{1}}, you have received a complimentary Special Dinner pass for _{{2}}_! Note from administration: {{3}}. View your pass in the Coupons section.
- **Variables:**
  - `{{1}}`: Student Name
  - `{{2}}`: Meal Date (e.g., `24 Oct 2026`)
  - `{{3}}`: Message (e.g., `Diwali Feast Celebrations`)

---

### 4. OTP Verification (`otp_verification`)

- **Category:** `AUTHENTICATION`
- **Language:** `en`
- **Use Case:** Dispatched to student for 2FA / WhatsApp account linking verification.
- **Body Template:**
  > Your Campus Mess verification code is _{{1}}_. Valid for 10 minutes. Do not share this code with anyone.
- **Button:**
  - Type: Copy Code / URL Autofill
