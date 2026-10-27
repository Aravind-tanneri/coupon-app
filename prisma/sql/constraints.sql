-- ====================================================
-- RAW SQL CONSTRAINTS & EXTENSIONS (Phase 1.2)
-- ====================================================

-- 1. Enable btree_gist extension for exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Generated column for ReimbursementRequest countedRange ([startDate+1, endDate))
ALTER TABLE "ReimbursementRequest"
  ADD COLUMN IF NOT EXISTS "countedRange" daterange
  GENERATED ALWAYS AS (daterange("startDate" + 1, "endDate", '[)')) STORED;

-- 3. Exclusion constraint: no overlapping claims for the same student
ALTER TABLE "ReimbursementRequest"
  DROP CONSTRAINT IF EXISTS no_overlapping_claims;

ALTER TABLE "ReimbursementRequest"
  ADD CONSTRAINT no_overlapping_claims
  EXCLUDE USING gist ("studentId" WITH =, "countedRange" WITH &&)
  WHERE (status NOT IN ('DRAFT', 'REJECTED', 'CANCELLED'));

-- 4. Exclusion constraint: no overlapping policy dates for the same mess
ALTER TABLE "ReimbursementPolicy"
  DROP CONSTRAINT IF EXISTS no_overlapping_policies;

ALTER TABLE "ReimbursementPolicy"
  ADD CONSTRAINT no_overlapping_policies
  EXCLUDE USING gist (
    "messId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveUntil", 'infinity'::date), '[)') WITH &&
  );

-- 5. Partial unique indexes (§21)
-- Prevent duplicate non-revoked gifts for the same student on the same meal date
CREATE UNIQUE INDEX IF NOT EXISTS "idx_coupon_gift_unique"
  ON "Coupon" ("studentId", "validDate", "mealType")
  WHERE "source" = 'ADMIN_GIFT' AND "status" <> 'REVOKED';

-- Exactly one ACTIVE WhatsAppIdentity per student
CREATE UNIQUE INDEX IF NOT EXISTS "idx_whatsapp_active_identity"
  ON "WhatsAppIdentity" ("studentId")
  WHERE "status" = 'ACTIVE';

-- Exactly one ACTIVE Conversation per verified identity
CREATE UNIQUE INDEX IF NOT EXISTS "idx_conversation_active"
  ON "Conversation" ("identityId")
  WHERE "status" = 'ACTIVE';

-- 6. Immutability rules for audit and status history tables
CREATE OR REPLACE RULE no_update_audit_log AS ON UPDATE TO "AuditLog" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_audit_log AS ON DELETE TO "AuditLog" DO INSTEAD NOTHING;

CREATE OR REPLACE RULE no_update_reimbursement_history AS ON UPDATE TO "ReimbursementStatusHistory" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_reimbursement_history AS ON DELETE TO "ReimbursementStatusHistory" DO INSTEAD NOTHING;
