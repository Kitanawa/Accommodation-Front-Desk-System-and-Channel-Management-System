DROP INDEX IF EXISTS booking_attempts_account;
ALTER TABLE booking_attempts DROP COLUMN IF EXISTS account_id;
DROP TABLE IF EXISTS guest_account_sessions;
DROP TABLE IF EXISTS guest_accounts;
