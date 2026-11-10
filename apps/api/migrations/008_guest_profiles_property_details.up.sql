-- Staff web app: guest profiles that belong to a property, and property details (name and address are on properties; contact and logo go with the settings).
ALTER TABLE guests ADD COLUMN property_id uuid REFERENCES properties;
ALTER TABLE guests ADD COLUMN language    varchar(40);
ALTER TABLE guests ADD COLUMN requests    text;
ALTER TABLE guests ADD COLUMN deleted_at  timestamptz;
UPDATE guests g SET property_id = (SELECT r.property_id FROM reservations r WHERE r.guest_id = g.guest_id ORDER BY r.created_at LIMIT 1);
CREATE INDEX guests_property ON guests (property_id) WHERE deleted_at IS NULL;
ALTER TABLE property_settings ADD COLUMN contact_email  varchar(160);
ALTER TABLE property_settings ADD COLUMN contact_phone  varchar(30);
ALTER TABLE property_settings ADD COLUMN logo_data_url  text;
