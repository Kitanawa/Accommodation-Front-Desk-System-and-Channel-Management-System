-- Room cleaning records: how urgent a clean is, who finished it and a note about the result.
ALTER TABLE housekeeping_tasks
  ADD COLUMN priority        varchar(6) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH')),
  ADD COLUMN done_by         uuid REFERENCES users(user_id),
  ADD COLUMN completion_note varchar(300);
CREATE INDEX housekeeping_room_done ON housekeeping_tasks (room_id, done_at DESC) WHERE status = 'DONE';
