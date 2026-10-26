-- 005_reservations_m11 (M11, S079 to S087): inventory holds, No-Show, status remarks and stay timestamps, search indexes.

-- S085: a reservation can end as NO_SHOW.
ALTER TABLE reservations DROP CONSTRAINT reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT','CANCELLED','NO_SHOW'));
ALTER TABLE reservations ADD COLUMN status_remark    varchar(300);   -- cancellation reason or the No-Show remark
ALTER TABLE reservations ADD COLUMN status_changed_at timestamptz;
ALTER TABLE reservations ADD COLUMN checked_in_at    timestamptz;
ALTER TABLE reservations ADD COLUMN checked_out_at   timestamptz;

-- S080: a hold keeps one room of a room type for the nights of a stay for a few minutes, while staff take the guest's details.
-- It is counted in room_stock.reserved_rooms the same way as a reservation, so every channel sees it.
CREATE TABLE reservation_holds (
  hold_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id   uuid NOT NULL REFERENCES room_types,
  check_in_date  date NOT NULL,
  check_out_date date NOT NULL,
  total_guests   smallint NOT NULL CHECK (total_guests > 0),
  status         varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONFIRMED','RELEASED','EXPIRED')),
  expires_at     timestamptz NOT NULL,
  created_by     uuid REFERENCES users(user_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  reservation_id uuid REFERENCES reservations,
  CHECK (check_out_date > check_in_date)
);
CREATE INDEX reservation_holds_active ON reservation_holds (expires_at) WHERE status='ACTIVE';

-- S082: search and filters
CREATE INDEX reservations_property_checkin ON reservations (property_id, check_in_date);
CREATE INDEX reservations_property_status ON reservations (property_id, status);
CREATE INDEX reservation_rooms_type ON reservation_rooms (room_type_id);
