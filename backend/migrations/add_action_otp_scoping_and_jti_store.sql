-- Migration: add action scoping to email_verifications and create used_action_tokens table
-- Addresses security findings from PR #353:
--   1. OTPs must be scoped to the action they were issued for.
--   2. Action tokens must be single-use (JTI stored after first use).

-- 1. Add the `action` column to email_verifications.
--    NULL = general-purpose OTP (e.g. email verification at signup).
--    Non-null = privileged-action OTP scoped to a specific ActionType.
ALTER TABLE email_verifications
  ADD COLUMN IF NOT EXISTS action TEXT;

-- Composite index to speed up the scoped OTP lookup in action-otp/verify.
CREATE INDEX IF NOT EXISTS ev_user_action_idx
  ON email_verifications (user_id, action);

-- Partial unique index: at most one active action-scoped OTP per (user, action)
-- at a time.  This is the DB-level serialization invariant that prevents two
-- concurrent storeOTP calls from both inserting an unused record for the same
-- user/action pair before either invalidation lands.
CREATE UNIQUE INDEX IF NOT EXISTS ev_one_active_action_otp_idx
  ON email_verifications (user_id, action)
  WHERE is_used = false AND action IS NOT NULL;

-- Similarly, at most one active general-purpose OTP per user.
CREATE UNIQUE INDEX IF NOT EXISTS ev_one_active_general_otp_idx
  ON email_verifications (user_id)
  WHERE is_used = false AND action IS NULL;

-- 2. Create the used_action_tokens table for single-use JTI enforcement.
--    Use TIMESTAMPTZ to stay consistent with the Drizzle schema definition.
CREATE TABLE IF NOT EXISTS used_action_tokens (
  jti        TEXT        NOT NULL PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS uat_expires_at_idx
  ON used_action_tokens (expires_at);
