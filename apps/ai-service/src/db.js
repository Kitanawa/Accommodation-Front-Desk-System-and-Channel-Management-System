// The assistant's ONLY database access. Everything here is read-only, in three independent layers:
//  1. The database user (fds_ai_readonly, see db/create_readonly_role.sql) has no write right on anything. PostgreSQL itself refuses writes. This is the guarantee.
//  2. Every connection starts read-only, and every query runs inside BEGIN READ ONLY.
//  3. This code only accepts a single SELECT (or WITH ... SELECT) statement and rejects write keywords.
// src/guard.js checks layer 1 at startup and every minute; if the user could write anything, the assistant stops using the database.
import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v);          // DATE as 'YYYY-MM-DD', not a JavaScript Date
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC as a number
pg.types.setTypeParser(20, (v) => Number(v));    // BIGINT (counts) as a number

export const configured = () => Boolean(process.env.AI_DATABASE_URL);

const WRITE_WORDS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|merge|call|do|vacuum|reindex|set|reset|lock|listen|notify|comment|security|import|refresh)\b/i;
export function checkReadOnlySql(sql) {
  if (typeof sql !== 'string' || !/^\s*(select|with)\b/i.test(sql)) throw new Error('Only SELECT statements are allowed.');
  if (/;\s*\S/.test(sql)) throw new Error('Only one statement at a time is allowed.');
  if (WRITE_WORDS.test(sql.replace(/'(?:[^']|'')*'/g, "''"))) throw new Error('This statement contains a word that is not allowed in a read-only query.');   // text inside quotes is ignored
}

let pool = null;
export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.AI_DATABASE_URL, max: 4, connectionTimeoutMillis: 4000,
      options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000',
    });
    pool.on('error', (e) => console.warn('database connection error:', e.message));
  }
  return pool;
}
export async function closePool() { if (pool) { await pool.end(); pool = null; } }

// q(sql, params) -> rows. One short read-only transaction per query.
export function makeQ(p = getPool()) {
  return async (sql, params = []) => {
    checkReadOnlySql(sql);
    const c = await p.connect();
    try {
      await c.query('BEGIN READ ONLY');
      const r = await c.query(sql, params);
      await c.query('ROLLBACK');
      return r.rows;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* connection already gone */ }
      throw e;
    } finally {
      c.release();
    }
  };
}
