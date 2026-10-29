# Campus Mess Management System — Administrator User Guide (§26.2)

**Version:** 1.0.0  
**Target Audience:** Mess Wardens, Caterers, Finance Officers, Counter Staff, System Administrators

---

## 1. System Access & Role-Based Permissions

Access the administrative web portal at **`https://admin.campusmess.in`**.

The system enforces strict Role-Based Access Control (RBAC):

| Role                | Target Users                  | Allowed Capabilities                                                                                   |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **`SUPER_ADMIN`**   | Chief Warden / Head of Dining | Full system access across all campus messes; user management; system settings; audit logs.             |
| **`MESS_ADMIN`**    | Mess Warden / Hall Supervisor | Scoped to assigned dining hall. Manages menus, coupon products, gift batches, and claim reviews.       |
| **`FINANCE_ADMIN`** | Accounts & Finance Section    | Reviews approved claims, records bank transfer / UPI UTR payment numbers, exports financial manifests. |
| **`COUNTER_STAFF`** | Mess Counter Attendant        | Operates redemption scanner console; verifies QR passes and short codes; monitors redemption stats.    |

---

## 2. Navigating the Admin Console

### 2.1 Dashboard (`/`)

- **Key Metrics:** Real-time snapshot of daily meal attendance, total coupons issued today, active claims awaiting review, and average student satisfaction rating.
- **Quick Actions:** Jump directly to today's redemption scanner or pending reimbursement queue.

### 2.2 Menus & Announcements (`/menus`)

- **Publishing Menus:** Select meal slot (`BREAKFAST`, `LUNCH`, `SNACKS`, `DINNER`). Add dish items with tags (`VEG`, `NON_VEG`, `EGG`, `JAIN`, `SPECIAL`).
- **Emergency Announcements:** Publish campus-wide or hall-specific broadcast banners (e.g., _"Power outage scheduled: Dinner moved to 7:30 PM"_). All announcements render safely as plain text.

### 2.3 Coupons & Catalog (`/coupons`)

- **Product Management:** Configure extra-meal items available for purchase by students via WhatsApp.
  - Set occasion name, meal type, valid date, price (in rupees / stored in integer paise), and purchase cutoff time.
- **Inventory Tracking:** Real-time summary showing total issued, active, redeemed, and revoked coupons.

### 2.4 Counter Redemption Console (`/redemptions`)

Designed specifically for touchscreen tablets and handheld barcode/QR scanners at the dining hall entrance:

- **Scan Mode:** Point camera or external 2D barcode scanner at the student's WhatsApp QR pass.
- **Short Code Entry:** Counter staff can manually type the 8-character Crockford base32 code (e.g. `7B9K2M4P`).
- **Visual Feedback:**
  - 🟢 **Success (Green):** Displays student name, roll number, meal type, and meal entitlement. Plays pleasant chime.
  - 🔴 **Rejected (Red):** Displays explicit reason (e.g., `ALREADY_REDEEMED`, `WRONG_MEAL_WINDOW`, `WRONG_MESS`, `COUPON_EXPIRED`). Refuses double redemptions.

### 2.5 Reimbursements & Rebates (`/reimbursements`)

- **Claim Queue:** Filter claims by status (`SUBMITTED`, `UNDER_REVIEW`, `INFO_REQUESTED`, `APPROVED`, `PAID`, `REJECTED`).
- **Review Drawer:**
  - Shows calculation breakdown (e.g., `10 Oct – 17 Oct: 6 days @ ₹131/day = ₹786.00`).
  - **Supporting Documents:** Click document link to generate a secure, 60-second temporary signed URL. Document access is recorded in the audit log.
  - **Action Buttons:**
    - **Approve:** Approves claim with server-side optimistic concurrency guard.
    - **Request Info:** Prompts student via WhatsApp to supply additional leave certificates.
    - **Reject:** Requires mandatory audit remark explaining reason.
- **Payment Recording (Finance Role):**
  - Record payment reference / UTR number once NEFT/IMPS transfer executes.
  - Automatically triggers WhatsApp status update notification to the student.

### 2.6 Special-Dinner Feast Gifting (`/gifts`)

Enables issuing complimentary feast passes for festivals (e.g. Diwali Feast, Hostel Day Banquet):

- **Issue Batch:**
  - Select Dining Hall and target meal date.
  - Choose recipient students via multi-select search (e.g. all hostel residents or specific roll numbers).
  - Add festival message banner.
  - Click **Issue Batch** (protected by client-generated idempotency key to prevent accidental double-clicks).
- **Multi-Channel Distribution:**
  - Coupons are sent immediately to student WhatsApp accounts and official campus emails (`/c/<shortCode>`).
  - Track delivery status: displays sent, delivered, read, or bounced.
- **Atomic Revocation:** Individual gift passes can be revoked with a single click before redemption. If the student has already redeemed the pass, revocation is refused atomically.

### 2.7 Feedback & Dining Quality (`/feedback`)

- Review student ratings (1–5 stars) submitted via WhatsApp.
- Filter by meal slot and category tags (`TASTE`, `HYGIENE`, `QUANTITY`, `TEMPERATURE`, `SERVICE`).
- Inspect student photos of meals uploaded through WhatsApp.
- Mark items as **Reviewed** after addressing catering feedback.

### 2.8 Student Roster (`/students`)

- View student profile, roll number, department, hostel, and assigned dining hall.
- **CSV Bulk Import:** Upload term enrollment rosters in one click.
- **Phone Link Management:** Reset phone binding if a student loses access to their registered WhatsApp device.

### 2.9 Immutable Audit Log (`/audit`)

- Searchable chronological ledger of every administrative action, claim state mutation, document view, and gift issuance.
- Displays Actor ID, Role, Action Type, Target Entity, Timestamp (IST), IP address, and before/after metadata snapshots.
