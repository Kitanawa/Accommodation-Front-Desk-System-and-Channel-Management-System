-- Guest accounts for the direct booking website: a guest signs up once and sees the bookings made while signed in.
-- Separate from staff users on purpose: a guest account never gets a role or any staff permission.
CREATE TABLE guest_accounts (
  account_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES properties,
  full_name          varchar(120) NOT NULL,
  email              varchar(160) NOT NULL,
  phone              varchar(30),
  password_hash      text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  failed_login_count smallint NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_login_at      timestamptz
);
CREATE UNIQUE INDEX guest_accounts_email ON guest_accounts (property_id, lower(email));

CREATE TABLE guest_account_sessions (
  session_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES guest_accounts ON DELETE CASCADE,
  token_hash   char(64) NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX guest_account_sessions_active ON guest_account_sessions (account_id) WHERE revoked_at IS NULL;

-- a booking made while signed in belongs to that account
ALTER TABLE booking_attempts ADD COLUMN account_id uuid REFERENCES guest_accounts;
CREATE INDEX booking_attempts_account ON booking_attempts (account_id) WHERE account_id IS NOT NULL;
