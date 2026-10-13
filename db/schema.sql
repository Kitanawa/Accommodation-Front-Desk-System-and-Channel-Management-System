-- Front Desk AI prototype: database schema
-- Works on MySQL 8.0+ and MariaDB 10.5+. FAKE DATA ONLY (see seed.sql).
--
-- Business rules this schema supports (from the client meeting):
--   * "Block the room" = book/reserve a room type for dates (status 'blocked').
--   * A blocked booking can be cancelled free until 72 hours before check-in.
--     After that it becomes 'confirmed', an invoice email is sent, and it can
--     no longer be cancelled in the system (handled by a backend job, not the AI).
--   * Availability is counted per ROOM TYPE per night; room numbers are assigned
--     later on the planner (bookings.room_id stays NULL until then).

CREATE DATABASE IF NOT EXISTS frontdesk_ai
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE frontdesk_ai;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS ai_audit_log, bookings, rates, rooms, travel_agents, guests, room_types;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE room_types (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL UNIQUE,
  description VARCHAR(255),
  max_guests  TINYINT      NOT NULL,
  base_rate   DECIMAL(10,2) NOT NULL          -- RM per night, used when no seasonal rate applies
);

CREATE TABLE rooms (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_number  VARCHAR(10) NOT NULL UNIQUE,
  room_type_id INT NOT NULL,
  status       ENUM('available','occupied','cleaning','maintenance') NOT NULL DEFAULT 'available',
  FOREIGN KEY (room_type_id) REFERENCES room_types(id)
);

-- Date-range rates. The latest matching row (highest id) wins; otherwise base_rate.
CREATE TABLE rates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_type_id INT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,                 -- inclusive
  rate         DECIMAL(10,2) NOT NULL,
  label        VARCHAR(50),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  CHECK (end_date >= start_date)
);

CREATE TABLE guests (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  phone     VARCHAR(30),
  email     VARCHAR(100)
);

CREATE TABLE travel_agents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  contact_email VARCHAR(100)
);

CREATE TABLE bookings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  booking_ref     VARCHAR(20) NOT NULL UNIQUE,
  guest_id        INT NULL,
  travel_agent_id INT NULL,
  room_type_id    INT NOT NULL,
  room_id         INT NULL,                    -- assigned later on the planner
  check_in        DATE NOT NULL,
  check_out       DATE NOT NULL,               -- exclusive: the guest leaves this morning
  num_guests      TINYINT NOT NULL DEFAULT 1,
  source          ENUM('walk_in','phone','email','whatsapp','travel_agent','direct_website','ota') NOT NULL,
  status          ENUM('blocked','confirmed','cancelled','checked_in','checked_out') NOT NULL,
  payment_status  ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  total_amount    DECIMAL(10,2) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at    DATETIME NULL,
  cancelled_at    DATETIME NULL,
  FOREIGN KEY (guest_id)        REFERENCES guests(id),
  FOREIGN KEY (travel_agent_id) REFERENCES travel_agents(id),
  FOREIGN KEY (room_type_id)    REFERENCES room_types(id),
  FOREIGN KEY (room_id)         REFERENCES rooms(id),
  CHECK (check_out > check_in),
  INDEX idx_availability (room_type_id, status, check_in, check_out)
);

-- Every AI interaction is logged: used for the 200-question accuracy test
-- and to audit what the assistant said and what data backed it.
CREATE TABLE ai_audit_log (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  staff_user       VARCHAR(50),
  user_message     TEXT NOT NULL,
  parsed_request   TEXT,                       -- JSON the model produced
  db_result        TEXT,                       -- JSON the backend returned
  reply_text       TEXT,
  validator_passed TINYINT(1)
);
