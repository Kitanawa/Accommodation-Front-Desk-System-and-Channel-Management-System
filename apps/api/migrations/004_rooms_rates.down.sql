ALTER TABLE charges DROP COLUMN add_on_id;
UPDATE charges SET charge_type='ADDITIONAL' WHERE charge_type='ADD_ON';
ALTER TABLE charges DROP CONSTRAINT charges_charge_type_check;
ALTER TABLE charges ADD CONSTRAINT charges_charge_type_check CHECK (charge_type IN ('ROOM','ADDITIONAL'));
DROP TABLE add_ons;
DROP INDEX one_pending_revision_per_rate;
DROP INDEX one_current_base_per_room_type;
-- rows replaced by a later rate would give two approved Base Rates again: keep only the newest approved one
DELETE FROM rate_rules WHERE rule_type='BASE' AND approval_status='APPROVED' AND valid_until IS NOT NULL;
UPDATE rate_rules SET supersedes_id=NULL;
CREATE UNIQUE INDEX one_approved_base_per_room_type ON rate_rules (room_type_id) WHERE rule_type='BASE' AND approval_status='APPROVED';
ALTER TABLE rate_rules DROP COLUMN valid_until;
ALTER TABLE rate_rules DROP COLUMN effective_from;
ALTER TABLE rate_rules DROP COLUMN supersedes_id;
ALTER TABLE room_types DROP COLUMN approval_status;
DROP INDEX room_types_name_ci;
DROP INDEX room_categories_name_ci;
ALTER TABLE rooms DROP COLUMN floor;
