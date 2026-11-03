// Tries to WRITE as the assistant's database user and checks that PostgreSQL refuses every attempt.
// Safe by design: it never starts if the guard sees a write right, and every attempt runs inside a transaction that is rolled back
// and is written to change nothing (WHERE false) even if it were allowed.
import { checkReadOnlyRole } from './guard.js';
import { makeQ } from './db.js';

const ATTEMPTS = [
  ['INSERT a row', ['INSERT INTO guests (full_name) SELECT \'x\' WHERE false']],
  ['UPDATE rows', ['UPDATE room_stock SET reserved_rooms = reserved_rooms WHERE false']],
  ['DELETE rows', ['DELETE FROM reservations WHERE false']],
  ['TRUNCATE a table', ['TRUNCATE guests']],
  ['DROP a table', ['DROP TABLE guests']],
  ['CREATE a table', ['CREATE TABLE ai_should_not_exist (x int)']],
  ['ALTER a table', ['ALTER TABLE guests ADD COLUMN ai_should_not_exist int']],
  ['GRANT rights to itself', ['GRANT ALL ON guests TO fds_ai_readonly']],
  ['CREATE a user', ['CREATE ROLE ai_should_not_exist']],
  ['write inside a WITH query', ['WITH x AS (DELETE FROM guests WHERE false RETURNING 1) SELECT 1']],
  ['turn read-only off, then UPDATE', ['SET TRANSACTION READ WRITE', 'UPDATE room_stock SET reserved_rooms = reserved_rooms WHERE false']],
  ['turn read-only off for the session, then INSERT', ['SET default_transaction_read_only = off', 'SET transaction_read_only = off', 'INSERT INTO guests (full_name) SELECT \'x\' WHERE false']],
  ['read password hashes', ['SELECT password_hash FROM users LIMIT 1']],
  ['read login sessions', ['SELECT token_hash FROM user_sessions LIMIT 1']],
  ['read payments', ['SELECT amount FROM payments LIMIT 1']],
  ['read the audit log', ['SELECT action FROM audit_records LIMIT 1']],
  ['read guest phone numbers', ['SELECT phone FROM guests LIMIT 1']],
  ['read guest passport numbers', ['SELECT id_passport_no FROM guests LIMIT 1']],
];

export async function runBattery(pool) {
  const guard = await checkReadOnlyRole(makeQ(pool));
  if (!guard.ok) return { guard, results: [] };       // do not attempt anything if the user already looks able to write
  const results = [];
  for (const [name, statements] of ATTEMPTS) {
    const c = await pool.connect();
    let blocked = false, detail = 'NOT BLOCKED';
    try {
      await c.query('BEGIN');
      for (const s of statements) await c.query(s);
    } catch (e) { blocked = true; detail = `${e.code || ''} ${e.message}`.trim(); }
    finally { try { await c.query('ROLLBACK'); } catch { /* connection already ended */ } c.release(); }
    results.push({ name, blocked, detail });
  }
  return { guard, results };
}
