// Integration tests against a REAL PostgreSQL server. They are skipped unless TEST_ADMIN_URL is set, for example
//   TEST_ADMIN_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/fds   (a database that already has the team's migrations and seed)
// and `psql` is installed. They create the read-only user, then check that it really cannot write and that answers match the team's API logic.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ADMIN = process.env.TEST_ADMIN_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
let hasPsql = true;
try { execFileSync('psql', ['--version'], { stdio: 'ignore' }); } catch { hasPsql = false; }
const skip = !ADMIN || !hasPsql ? 'set TEST_ADMIN_URL (and install psql) to run the database tests' : false;

describe('read-only database user (real PostgreSQL)', { skip }, () => {
  let admin, aiUrl, mods, fakeApi, propertyId;

  before(async () => {
    execFileSync('psql', [ADMIN, '-q', '-v', 'ai_password=aipass-test', '-f', path.join(here, '..', 'db', 'create_readonly_role.sql')], { stdio: 'ignore' });
    const u = new URL(ADMIN); u.username = 'fds_ai_readonly'; u.password = 'aipass-test'; aiUrl = u.toString();
    admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
    propertyId = (await admin.query('select property_id from properties limit 1')).rows[0].property_id;
    // a tiny fake of GET /api/me, so the chat can be tested without the team's API running
    fakeApi = http.createServer((req, res) => {
      const ok = req.url === '/api/me' && req.method === 'GET' && /fds_session=valid/.test(req.headers.cookie || '');
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { user_id: 'u1', property_id: propertyId, role: 'FRONT_DESK', name: 'Test' } : { error: 'no' }));
    });
    await new Promise((r) => fakeApi.listen(0, '127.0.0.1', r));
    process.env.API_URL = `http://127.0.0.1:${fakeApi.address().port}`;
    process.env.AI_DATABASE_URL = aiUrl;
    process.env.LLM_PROVIDER = 'rules';
    mods = { db: await import('../src/db.js'), guard: await import('../src/guard.js'), verify: await import('../src/verify.js'), facts: await import('../src/facts.js'), state: await import('../src/dbstate.js'), chat: await import('../src/chat.js') };
  });
  after(async () => { await mods?.db.closePool(); await admin?.end(); fakeApi?.close(); });

  const checksum = async () => {
    const t = (await admin.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows;
    const out = {};
    for (const { tablename } of t) out[tablename] = (await admin.query(`select count(*)::int n, md5(coalesce(string_agg(x::text, '' order by x::text), '')) h from "${tablename}" x`)).rows[0];
    return JSON.stringify(out);
  };

  test('the guard accepts the read-only user and rejects the admin user', async () => {
    assert.deepEqual((await mods.guard.checkReadOnlyRole(mods.db.makeQ())).problems, []);
    const adminQ = mods.db.makeQ(admin);
    const r = await mods.guard.checkReadOnlyRole(adminQ);
    assert.equal(r.ok, false);
    assert.ok(r.problems.length > 3);
  });

  test('every write and every forbidden read is refused by PostgreSQL itself', async () => {
    const before = await checksum();
    const { guard, results } = await mods.verify.runBattery(mods.db.getPool());
    assert.equal(guard.ok, true);
    assert.ok(results.length >= 15);
    for (const r of results) assert.equal(r.blocked, true, `${r.name}: ${r.detail}`);
    assert.equal(await checksum(), before);
  });

  test('the battery refuses to run for a user that could write', async () => {
    const { guard, results } = await mods.verify.runBattery(admin);
    assert.equal(guard.ok, false);
    assert.deepEqual(results, []);
  });

  test('a write that gets past the code check is still refused by the database', async () => {
    const before = await checksum();
    const c = await mods.db.getPool().connect();
    try {
      await assert.rejects(() => c.query('INSERT INTO guests (full_name) VALUES (\'sneaky\')'), /read-only|permission denied/);
      await c.query('SET default_transaction_read_only = off');   // even with read-only switched off, the missing rights stop the write
      await assert.rejects(() => c.query('UPDATE room_stock SET reserved_rooms = 0'), /permission denied/);
    } finally { c.release(true); }   // true = throw this connection away, so the altered session is never reused
    assert.equal(await checksum(), before);
  });

  test('sensitive columns cannot be read', async () => {
    const q = mods.db.makeQ();
    for (const sql of ['select password_hash from users', 'select phone from guests', 'select email from guests', 'select id_passport_no from guests', 'select token_hash from user_sessions', 'select amount from payments']) {
      await assert.rejects(() => q(sql), /permission denied/, sql);
    }
  });

  test('availability matches the team\'s own availability() on the seed data', async () => {
    const teamFile = path.resolve(here, '..', '..', 'api', 'service.js');
    if (!fs.existsSync(teamFile)) return;   // the API folder is not next to this one
    const S = createRequire(import.meta.url)(teamFile);
    const adminQ = async (sql, p = []) => (await admin.query(sql, p)).rows;
    const t = S.today();
    for (const [a, b, g] of [[0, 2, 1], [1, 3, 2], [3, 6, 4], [0, 1, 6], [30, 33, 2], [200, 202, 1]]) {
      const from = S.addDays(t, a), to = S.addDays(t, b);
      const theirs = await S.availability(adminQ, propertyId, { from, to, guests: g });
      const mine = await mods.facts.availability(mods.db.makeQ(), propertyId, { from, to, guests: g });
      assert.deepEqual(mine.map((x) => [x.name, x.rooms_left, x.total, x.bookable]), theirs.map((x) => [x.name, x.rooms_left, x.total, x.bookable]), `${from} to ${to}, ${g} guests`);
    }
  });

  test('queries are limited to the signed-in user\'s property', async () => {
    const q = mods.db.makeQ(), other = '00000000-0000-4000-8000-000000000000';
    assert.deepEqual(await mods.facts.roomTypes(q, other), []);
    assert.deepEqual(await mods.facts.availability(q, other, { from: '2030-01-01', to: '2030-01-02', guests: 1 }), []);
    assert.deepEqual((await mods.facts.unpaid(q, other)).rows, []);
    assert.deepEqual(await mods.facts.bookingsByGuest(q, other, 'Guest'), []);
  });

  test('chat answers from the database only for a signed-in user and only while the guard passes', async () => {
    await mods.state.refreshGuard();
    assert.equal(mods.state.dbStatus().status, 'read-only verified');
    const before = await checksum();
    const msg = 'Is Standard Twin available 1 nov to 3 nov';
    const signedIn = await mods.chat.handleChat(msg, { cookie: 'fds_session=valid', now: '2026-10-28' });
    assert.equal(signedIn.data, 'database (read-only)');
    assert.match(signedIn.reply, /Standard Twin/);
    const anon = await mods.chat.handleChat(msg, { now: '2026-10-28' });
    assert.equal(anon.data, 'none');
    assert.match(anon.reply, /signed in/);
    const badCookie = await mods.chat.handleChat(msg, { cookie: 'fds_session=nope', now: '2026-10-28' });
    assert.equal(badCookie.data, 'none');
    for (const m of ['who is arriving today', 'show unpaid bookings', 'how many people can each room type fit?', 'bookings for Guest', 'can R-ZZZZZZ be cancelled?', 'delete R-ZZZZZZ', 'give a discount']) {
      const r = await mods.chat.handleChat(m, { cookie: 'fds_session=valid', now: '2026-10-28' });
      assert.ok(r.reply.length > 0, m);
    }
    assert.equal(await checksum(), before, 'no table changed');
  });

  test('chat stops reading data when the database user is not read-only', async () => {
    const saved = process.env.AI_DATABASE_URL;
    await mods.db.closePool();
    process.env.AI_DATABASE_URL = ADMIN;
    await mods.state.refreshGuard();
    assert.match(mods.state.dbStatus().status, /^blocked/);
    const r = await mods.chat.handleChat('Is Standard Twin available 1 nov to 3 nov', { cookie: 'fds_session=valid', now: '2026-10-28' });
    assert.equal(r.data, 'none');
    await mods.db.closePool();
    process.env.AI_DATABASE_URL = saved;
    await mods.state.refreshGuard();
    assert.equal(mods.state.dbStatus().status, 'read-only verified');
  });
});
