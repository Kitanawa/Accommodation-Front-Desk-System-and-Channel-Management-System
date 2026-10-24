DROP TABLE IF EXISTS user_sessions;
DROP INDEX IF EXISTS users_email_lower;
ALTER TABLE users
  DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS failed_login_count, DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS password_changed_at, DROP COLUMN IF EXISTS last_login_at;
