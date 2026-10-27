-- 004_rooms_rates (M09, S060 to S069): floors for rooms, approval for room types, rate changes that wait for approval, add-ons.

-- S062: a physical room sits on a floor.
ALTER TABLE rooms ADD COLUMN floor smallint CHECK (floor BETWEEN -5 AND 200);

-- S060 / S061: names are unique ignoring upper/lower case (the old constraints were case sensitive).
CREATE UNIQUE INDEX room_categories_name_ci ON room_categories (property_id, lower(name));
CREATE UNIQUE INDEX room_types_name_ci ON room_types (category_id, lower(name));

-- S067: a new room type is submitted together with its rates and stays PENDING until approved.
ALTER TABLE room_types ADD COLUMN approval_status varchar(10) NOT NULL DEFAULT 'APPROVED'
  CHECK (approval_status IN ('PENDING','APPROVED'));

-- S068: a changed rate is a new PENDING row that points at the rate it replaces.
-- The approved rate stays in force until the new one is approved and its effective date is reached.
ALTER TABLE rate_rules ADD COLUMN supersedes_id uuid REFERENCES rate_rules(rate_rule_id);
ALTER TABLE rate_rules ADD COLUMN effective_from date;   -- first night the rule applies (null = no start limit)
ALTER TABLE rate_rules ADD COLUMN valid_until date;      -- first night the rule no longer applies (null = still current)
DROP INDEX one_approved_base_per_room_type;
CREATE UNIQUE INDEX one_current_base_per_room_type ON rate_rules (room_type_id)
  WHERE rule_type='BASE' AND approval_status='APPROVED' AND valid_until IS NULL;
CREATE UNIQUE INDEX one_pending_revision_per_rate ON rate_rules (supersedes_id)
  WHERE supersedes_id IS NOT NULL AND approval_status='PENDING';

-- S069: add-ons (extra bed, breakfast, ...) with their own approval, separate from room types.
CREATE TABLE add_ons (
  add_on_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES properties,
  name               varchar(80) NOT NULL,
  description        varchar(300),
  pricing_unit       varchar(12) NOT NULL DEFAULT 'PER_STAY' CHECK (pricing_unit IN ('PER_STAY','PER_NIGHT','PER_GUEST')),
  unit_price         numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  pending_unit_price numeric(12,2) CHECK (pending_unit_price >= 0),
  approval_status    varchar(10) NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING','APPROVED')),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX add_ons_name_ci ON add_ons (property_id, lower(name));

-- A charge made from an add-on keeps the price it had when it was posted (unit_price on the charge row).
ALTER TABLE charges DROP CONSTRAINT charges_charge_type_check;
ALTER TABLE charges ADD CONSTRAINT charges_charge_type_check CHECK (charge_type IN ('ROOM','ADDITIONAL','ADD_ON'));
ALTER TABLE charges ADD COLUMN add_on_id uuid REFERENCES add_ons;
