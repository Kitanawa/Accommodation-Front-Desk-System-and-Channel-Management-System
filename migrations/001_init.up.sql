-- 001_init: the 17 SRS entities (SRS Draft 2, section 5) plus the reference values they need.
CREATE TABLE properties (
  property_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(120) NOT NULL,
  address       text,
  currency_code char(3) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  role_id smallint PRIMARY KEY,
  name    varchar(30) NOT NULL UNIQUE
);
INSERT INTO roles VALUES (1,'ADMINISTRATOR'),(2,'OWNER_MANAGER'),(3,'FRONT_DESK');

CREATE TABLE users (
  user_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid NOT NULL REFERENCES properties,
  role_id           smallint NOT NULL REFERENCES roles,
  full_name         varchar(120) NOT NULL,
  email             varchar(160) NOT NULL UNIQUE,
  password_hash     varchar(255) NOT NULL,
  can_approve_rates boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_statuses (
  status_id smallint PRIMARY KEY,
  code      varchar(30) NOT NULL UNIQUE
);
INSERT INTO room_statuses VALUES (1,'AVAILABLE'),(2,'OCCUPIED'),(3,'CLEANING'),(4,'MAINTENANCE_BLOCKED');

CREATE TABLE booking_sources (
  source_id smallint PRIMARY KEY,
  code      varchar(30) NOT NULL UNIQUE,
  name      varchar(60) NOT NULL
);
INSERT INTO booking_sources VALUES
 (1,'WALK_IN','Walk-in'),(2,'PHONE','Phone'),(3,'EMAIL','Email'),
 (4,'WEBSITE','Direct website'),(5,'TRAVEL_AGENT','Travel agent'),(6,'OTA','OTA / channel manager');

CREATE TABLE room_categories (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties,
  name        varchar(80) NOT NULL,
  UNIQUE (property_id, name)
);

CREATE TABLE room_types (
  room_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES room_categories,
  name         varchar(100) NOT NULL,
  max_guests   smallint NOT NULL CHECK (max_guests > 0),
  min_nights   smallint NOT NULL DEFAULT 1 CHECK (min_nights > 0),
  description  text,
  facilities   jsonb,
  photos       jsonb,
  layout_info  text,
  UNIQUE (category_id, name)
);

CREATE TABLE rooms (
  room_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid NOT NULL REFERENCES room_types,
  status_id    smallint NOT NULL REFERENCES room_statuses DEFAULT 1,
  room_number  varchar(10) NOT NULL UNIQUE
);

CREATE TABLE room_stock (
  stock_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id   uuid NOT NULL REFERENCES room_types,
  stock_date     date NOT NULL,
  total_rooms    smallint NOT NULL CHECK (total_rooms >= 0),
  reserved_rooms smallint NOT NULL DEFAULT 0 CHECK (reserved_rooms >= 0),
  UNIQUE (room_type_id, stock_date),
  CHECK (reserved_rooms <= total_rooms)
);

CREATE TABLE rate_rules (
  rate_rule_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id    uuid NOT NULL REFERENCES room_types,
  rule_type       varchar(20) NOT NULL
                  CHECK (rule_type IN ('BASE','DATE_RANGE','SELECTED_DAY','SPECIFIC_DATE')),
  rate_amount     numeric(12,2) NOT NULL CHECK (rate_amount >= 0),
  date_from       date,
  date_to         date,
  selected_days   smallint[],
  specific_date   date,
  priority        smallint,
  approval_status varchar(10) NOT NULL DEFAULT 'PENDING'
                  CHECK (approval_status IN ('PENDING','APPROVED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (rule_type='BASE'          AND date_from IS NULL AND date_to IS NULL AND selected_days IS NULL AND specific_date IS NULL) OR
    (rule_type='DATE_RANGE'    AND date_from IS NOT NULL AND date_to IS NOT NULL AND date_to >= date_from AND selected_days IS NULL AND specific_date IS NULL) OR
    (rule_type='SELECTED_DAY'  AND selected_days IS NOT NULL AND cardinality(selected_days) > 0 AND specific_date IS NULL) OR
    (rule_type='SPECIFIC_DATE' AND specific_date IS NOT NULL AND date_from IS NULL AND date_to IS NULL AND selected_days IS NULL)
  )
);
CREATE UNIQUE INDEX one_approved_base_per_room_type
  ON rate_rules (room_type_id) WHERE rule_type='BASE' AND approval_status='APPROVED';

CREATE TABLE guests (
  guest_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      varchar(120) NOT NULL,
  phone          varchar(30),
  email          varchar(160),
  nationality    varchar(60),
  id_passport_no varchar(40),
  address        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  reservation_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_ref   varchar(20) NOT NULL UNIQUE,
  property_id       uuid NOT NULL REFERENCES properties,
  guest_id          uuid NOT NULL REFERENCES guests,
  source_id         smallint NOT NULL REFERENCES booking_sources,
  check_in_date     date NOT NULL,
  check_out_date    date NOT NULL,
  estimated_arrival time,
  total_guests      smallint NOT NULL CHECK (total_guests > 0),
  status            varchar(15) NOT NULL DEFAULT 'CONFIRMED'
                    CHECK (status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT','CANCELLED')),
  payment_status    varchar(10) NOT NULL DEFAULT 'UNPAID'
                    CHECK (payment_status IN ('UNPAID','PARTIAL','PAID')),
  special_requests  text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out_date > check_in_date)
);

CREATE TABLE reservation_rooms (
  reservation_room_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id      uuid NOT NULL REFERENCES reservations,
  room_type_id        uuid NOT NULL REFERENCES room_types,
  room_id             uuid REFERENCES rooms,
  rate_total          numeric(12,2) NOT NULL CHECK (rate_total >= 0)
);

CREATE TABLE folios (
  folio_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations,
  currency_code  char(3) NOT NULL,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);

CREATE TABLE charges (
  charge_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id    uuid NOT NULL REFERENCES folios,
  charge_type varchar(10) NOT NULL CHECK (charge_type IN ('ROOM','ADDITIONAL')),
  description varchar(200) NOT NULL,
  quantity    numeric(8,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
  charged_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  payment_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id          uuid NOT NULL REFERENCES folios,
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  currency_code     char(3) NOT NULL,
  method            varchar(20) NOT NULL,
  status            varchar(10) NOT NULL DEFAULT 'COMPLETED'
                    CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  gateway_reference varchar(80),
  paid_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_gateway_ref_once
  ON payments (gateway_reference) WHERE gateway_reference IS NOT NULL;

CREATE TABLE audit_records (
  audit_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES users,
  action      varchar(40) NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_id   uuid NOT NULL,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
