-- Creates (or resets) the database user the AI assistant uses: fds_ai_readonly.
-- Run ONCE per database, as a PostgreSQL superuser, from this folder:
--
--   psql -U postgres -d YOUR_DATABASE -v ai_password="CHOOSE_A_LONG_PASSWORD" -f db/create_readonly_role.sql
--
-- The password is given on the command line, so it is never stored in this file. Safe to run again: it resets the role to exactly the rights below.
-- WHY THIS MAKES THE ASSISTANT READ-ONLY: PostgreSQL itself refuses every write from this user. The assistant cannot change data even if its code,
-- its prompt or the AI model misbehaves. The user has no INSERT, UPDATE, DELETE, TRUNCATE or DDL right on anything, and every connection also starts
-- read-only. It can SELECT only the columns listed below: no passwords, no session tokens, no payments or folios, no phone numbers, emails or passport numbers.
\set ON_ERROR_STOP on

-- 1. the login role: not a superuser, cannot create databases or roles, cannot bypass row security, not a member of any other role
SELECT format('CREATE ROLE fds_ai_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5 PASSWORD %L', :'ai_password')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fds_ai_readonly') \gexec
SELECT format('ALTER ROLE fds_ai_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5 PASSWORD %L', :'ai_password') \gexec

-- 2. every session of this role is read-only by default and cannot run for long
ALTER ROLE fds_ai_readonly SET default_transaction_read_only = on;
ALTER ROLE fds_ai_readonly SET statement_timeout = '5s';
ALTER ROLE fds_ai_readonly SET idle_in_transaction_session_timeout = '10s';

-- 3. clean slate: remove anything this role was granted before (and any group memberships)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fds_ai_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM fds_ai_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM fds_ai_readonly;
REVOKE ALL ON SCHEMA public FROM fds_ai_readonly;
-- PostgreSQL 14 and older let every user create tables in the public schema. Close that (it is already the default from version 15).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM fds_ai_readonly', current_database()) \gexec

-- 4. the only things it may do: connect, look inside the schema, and SELECT these columns
SELECT format('GRANT CONNECT ON DATABASE %I TO fds_ai_readonly', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO fds_ai_readonly;
GRANT SELECT (property_id, name, currency_code) ON properties TO fds_ai_readonly;
GRANT SELECT (category_id, property_id, name) ON room_categories TO fds_ai_readonly;
GRANT SELECT (room_type_id, category_id, name, max_guests, min_nights, approval_status) ON room_types TO fds_ai_readonly;
GRANT SELECT (room_id, room_type_id, status_id, room_number) ON rooms TO fds_ai_readonly;
GRANT SELECT (status_id, code) ON room_statuses TO fds_ai_readonly;
GRANT SELECT (room_type_id, stock_date, total_rooms, reserved_rooms) ON room_stock TO fds_ai_readonly;
GRANT SELECT (room_type_id, rule_type, rate_amount, date_from, date_to, selected_days, specific_date, priority, approval_status, effective_from, valid_until) ON rate_rules TO fds_ai_readonly;
GRANT SELECT (guest_id, full_name) ON guests TO fds_ai_readonly;
GRANT SELECT (reservation_id, reservation_ref, property_id, guest_id, check_in_date, check_out_date, total_guests, status, payment_status) ON reservations TO fds_ai_readonly;
GRANT SELECT (reservation_id, room_type_id, room_id) ON reservation_rooms TO fds_ai_readonly;
-- Deliberately NOT granted: users, user_sessions, folios, charges, payments, audit_records, add_ons, and the phone, email, nationality,
-- passport and address columns of guests. New tables the team adds later stay invisible to the assistant until you grant them here.
