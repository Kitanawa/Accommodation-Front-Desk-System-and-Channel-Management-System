-- A change to an approved room type (name, category, guests, description, facilities, photos...) waits for approval, like a rate change.
-- The approved details stay in force until a manager approves; the waiting values are kept here.
ALTER TABLE room_types ADD COLUMN pending_changes jsonb;
ALTER TABLE room_types ADD COLUMN pending_by      uuid REFERENCES users;
ALTER TABLE room_types ADD COLUMN pending_at      timestamptz;
