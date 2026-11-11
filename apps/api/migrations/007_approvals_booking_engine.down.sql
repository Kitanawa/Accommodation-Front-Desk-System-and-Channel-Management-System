ALTER TABLE reservations DROP COLUMN cancel_fee;
DROP TABLE email_outbox;
DROP TABLE payment_events;
DROP TABLE payment_sessions;
DROP TABLE booking_attempts;
ALTER TABLE property_settings DROP COLUMN late_cancel_fee_pct;
ALTER TABLE property_settings DROP COLUMN free_cancellation_hours;
ALTER TABLE property_settings DROP COLUMN online_deposit_pct;
DROP TABLE approval_decisions;
