DROP INDEX IF EXISTS housekeeping_room_done;
ALTER TABLE housekeeping_tasks DROP COLUMN completion_note, DROP COLUMN done_by, DROP COLUMN priority;
