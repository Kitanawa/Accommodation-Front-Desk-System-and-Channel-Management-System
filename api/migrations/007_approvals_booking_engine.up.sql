-- 007_approvals_booking_engine (M17 and M21): the manager approval inbox, and the public booking engine.

-- ---- S137 / S138: every approve or reject decision is kept, with who, when and why ----
CREATE TABLE approval_decisions (
  decision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES properties,
  kind        varchar(10) NOT NULL CHECK (kind IN ('ROOM_TYPE','RATE','ADD_ON')),
  subject_id  uuid NOT NULL,
  decision    varchar(10) NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  reason      varchar(300),
  decided_by  uuid NOT NULL REFERENCES users(user_id),
  decided_at  timestamptz NOT NULL DEFAULT now(),
  snapshot    jsonb NOT NULL,
  CHECK (decision <> 'REJECTED' OR reason IS NOT NULL)
);
CREATE INDEX approval_decisions_property ON approval_decisions (property_id, decided_at DESC);
CREATE INDEX approval_decisions_subject ON approval_decisions (kind, subject_id);

-- ---- S150 / S151 / S175: online payment and cancellation rules (decisions are assumptions until the client confirms) ----
ALTER TABLE property_settings ADD COLUMN online_deposit_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (online_deposit_pct > 0 AND online_deposit_pct <= 100);
ALTER TABLE property_settings ADD COLUMN free_cancellation_hours smallint NOT NULL DEFAULT 48 CHECK (free_cancellation_hours BETWEEN 0 AND 720);
ALTER TABLE property_settings ADD COLUMN late_cancel_fee_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (late_cancel_fee_pct >= 0 AND late_cancel_fee_pct <= 100);

-- ---- S168 / S169: one row per guest booking attempt, linked to its inventory hold ----
CREATE TABLE booking_attempts (
  attempt_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties,
  hold_id        uuid NOT NULL REFERENCES reservation_holds,
  room_type_id   uuid NOT NULL REFERENCES room_types,
  check_in_date  date NOT NULL,
  check_out_date date NOT NULL,
  total_guests   smallint NOT NULL CHECK (total_guests > 0),
  guest_name     varchar(120) NOT NULL,
  guest_email    varchar(160) NOT NULL,
  guest_phone    varchar(30),
  special_requests varchar(500),
  currency_code  char(3) NOT NULL,
  subtotal       numeric(12,2) NOT NULL,
  tax_total      numeric(12,2) NOT NULL,
  total          numeric(12,2) NOT NULL,
  amount_due     numeric(12,2) NOT NULL CHECK (amount_due > 0),
  status         varchar(20) NOT NULL DEFAULT 'HOLDING'
                 CHECK (status IN ('HOLDING','PAYMENT_PENDING','CONFIRMED','FAILED','EXPIRED','ABANDONED','PAID_UNFULFILLED')),
  token_hash     char(64) NOT NULL,
  reservation_id uuid REFERENCES reservations,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX booking_attempts_hold ON booking_attempts (hold_id);
CREATE INDEX booking_attempts_open ON booking_attempts (expires_at) WHERE status IN ('HOLDING','PAYMENT_PENDING');

-- ---- S170: a payment session carries the amount and reference the server decided ----
CREATE TABLE payment_sessions (
  session_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id   uuid NOT NULL REFERENCES booking_attempts,
  reference    varchar(40) NOT NULL UNIQUE,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL,
  status       varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','FAILED','EXPIRED')),
  gateway_txn  varchar(80),
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);
CREATE UNIQUE INDEX payment_one_open_session ON payment_sessions (attempt_id) WHERE status = 'PENDING';

-- ---- S171 / S172: every webhook is recorded once by its event id, so a repeat does nothing ----
CREATE TABLE payment_events (
  event_id    varchar(80) PRIMARY KEY,
  reference   varchar(40),
  event_type  varchar(40) NOT NULL,
  amount      numeric(12,2),
  currency_code char(3),
  outcome     varchar(20) NOT NULL CHECK (outcome IN ('APPLIED','FAILED_APPLIED','IGNORED','REJECTED','UNFULFILLED')),
  detail      varchar(200),
  received_at timestamptz NOT NULL DEFAULT now()
);

-- ---- S174: confirmation e-mail waits here until a mail service exists; nothing is sent by this system yet ----
CREATE TABLE email_outbox (
  outbox_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties,
  reservation_id uuid REFERENCES reservations,
  to_email       varchar(160) NOT NULL,
  subject        varchar(200) NOT NULL,
  body           text NOT NULL,
  status         varchar(10) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
  attempts       smallint NOT NULL DEFAULT 0,
  last_error     varchar(200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);
CREATE UNIQUE INDEX email_outbox_once ON email_outbox (reservation_id, subject) WHERE reservation_id IS NOT NULL;

-- ---- S175: how a cancellation was priced ----
ALTER TABLE reservations ADD COLUMN cancel_fee numeric(12,2);
