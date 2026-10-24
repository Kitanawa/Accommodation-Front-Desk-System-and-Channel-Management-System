// Database layer. Uses real PostgreSQL when DATABASE_URL is set,
// otherwise an embedded PostgreSQL engine (PGlite) so the prototype runs with no install.
const path = require('path');
const fs = require('fs');
let impl;

// Embedded PostgreSQL engine (PGlite). dir = 'memory' for a throw-away database.
async function createEmbedded(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dir === 'memory' ? new PGlite() : new PGlite(dir);
  await db.waitReady;
  return {
    mode: dir === 'memory' ? 'embedded PostgreSQL (in memory)' : 'embedded PostgreSQL (PGlite, folder ./data)',
    q: async (s, p) => (await db.query(s, p)).rows,
    exec: s => db.exec(s),
    tx: fn => db.transaction(t => fn({ q: async (s, p) => (await t.query(s, p)).rows, exec: x => t.exec(x) })),
  };
}

async function connect() {
  if (impl) return impl;
  if (process.env.DATABASE_URL) {
    const { Pool, types } = require('pg');
    types.setTypeParser(1082, v => v); // keep DATE columns as 'YYYY-MM-DD'
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    impl = {
      mode: 'PostgreSQL server (DATABASE_URL)',
      q: async (s, p) => (await pool.query(s, p)).rows,
      exec: s => pool.query(s),
      tx: async fn => {
        const c = await pool.connect();
        try { await c.query('BEGIN'); const r = await fn({ q: async (s, p) => (await c.query(s, p)).rows, exec: x => c.query(x) }); await c.query('COMMIT'); return r; }
        catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      },
    };
  } else {
    impl = await createEmbedded(process.env.PGLITE_DIR || path.join(__dirname, 'data'));
  }
  return impl;
}

// Bring the database to the latest migration; load anonymous fixtures once if it is empty (SEED_ON_START=false to skip).
async function ensureSchema() {
  const d = await connect();
  await require('./migrate').up(d);
  if (process.env.SEED_ON_START !== 'false') {
    const [n] = await d.q('select count(*)::int c from users');
    if (!n.c) { await require('./seed').seed(d); console.log('Anonymous fixtures loaded.'); }
  }
  return d;
}
module.exports = { connect, ensureSchema, createEmbedded };
