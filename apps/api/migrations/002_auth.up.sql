-- 002_auth: what S056 (sessions, revocation) and S058 (staff accounts) need beyond the SRS entity list.
ALTER TABLE users
  ADD COLUMN is_active           boolean     NOT NULL DEFAULT true,
  ADD COLUMN failed_login_count  smallint    NOT NULL DEFAULT 0,
  ADD COLUMN locked_until        timestamptz,
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_login_at       timestamptz;
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE user_sessions (
  session_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users,
  token_hash     char(64) NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason varchar(30),
  user_agent     varchar(200)
);
CREATE INDEX user_sessions_active_by_user ON user_sessions (user_id) WHERE revoked_at IS NULL;
