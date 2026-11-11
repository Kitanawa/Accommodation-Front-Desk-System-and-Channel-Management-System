ALTER TABLE property_settings DROP COLUMN logo_data_url, DROP COLUMN contact_phone, DROP COLUMN contact_email;
DROP INDEX guests_property;
ALTER TABLE guests DROP COLUMN deleted_at, DROP COLUMN requests, DROP COLUMN language, DROP COLUMN property_id;
