// S056: authentication, password hashing, session revocation.
const { ok, summary, boot, api, tok, DEMO } = require('./helpers');
const { hashPassword, verifyPassword, needsRehash } = require('../password');
const crypto = require('crypto');
const login = (u, pw) => api('POST', '/api/login', { email: u.email, password: pw || u.password });
const fd = DEMO.frontdesk;

(async () => {
  await boot(); const db = await require('../db').connect();
  // ---- hashing
  const h1 = await hashPassword('Same-Password-123'), h2 = await hashPassword('Same-Password-123');
  ok(/^scrypt\$32768\$8\$1\$/.test(h1) && h1 !== h2, 'hashes are scrypt with a different random salt each time');
  ok(await verifyPassword('Same-Password-123', h1) && !(await verifyPassword('Same-Password-124', h1)), 'verify accepts the right password and rejects a near-miss');
  ok(!(await verifyPassword('x', 'garbage')) && !(await verifyPassword('x', 'scrypt$1$1$1$a$')), 'a malformed stored hash never verifies');
  ok(needsRehash('scrypt$16384$8$1$a$b') && !needsRehash(h1), 'a hash with weaker settings is flagged for upgrade');
  const weak = 'scrypt$16384$8$1$' + Buffer.from('saltsaltsaltsalt').toString('base64') + '$' + crypto.scryptSync('Old-Weak-Pass-1', 'saltsaltsaltsalt', 32, { N: 16384, r: 8, p: 1 }).toString('base64');
  await db.q("update users set password_hash=$1 where email=$2", [weak, DEMO.manager.email]);
  ok((await login(DEMO.manager, 'Old-Weak-Pass-1')).status === 200, 'a user with an old weaker hash can still sign in');
  const [{ password_hash }] = await db.q('select password_hash from users where email=$1', [DEMO.manager.email]);
  ok(!needsRehash(password_hash) && await verifyPassword('Old-Weak-Pass-1', password_hash), 'and the hash is upgraded to the current settings at that moment');
  await db.q("update users set password_hash=$1 where email=$2", [await hashPassword(DEMO.manager.password), DEMO.manager.email]);

  // ---- tokens are not stored
  const l = await login(fd); const token = l.body.token;
  const rows = await db.q('select token_hash from user_sessions');
  ok(rows.every(r => r.token_hash !== token && /^[0-9a-f]{64}$/.test(r.token_hash)), 'the database holds only SHA-256 hashes of tokens, never a token');
  ok((await db.q('select 1 x from user_sessions where token_hash=$1', [crypto.createHash('sha256').update(token).digest('hex')])).length === 1, 'the stored hash is the SHA-256 of the token');
  ok(l.body.token.length >= 43 && l.body.token !== (await login(fd)).body.token, 'tokens are long and unique per sign-in');

  // ---- unknown email and wrong password look identical
  const wrong = await login(fd, 'Wrong-Password-1'), unknown = await api('POST', '/api/login', { email: 'nobody@fds.test', password: 'Wrong-Password-1' });
  ok(wrong.status === unknown.status && wrong.body.error.code === unknown.body.error.code && wrong.body.error.message === unknown.body.error.message, 'unknown email and wrong password give the identical answer');
  ok((await api('POST', '/api/login', { email: 'FrontDesk@FDS.test', password: fd.password })).status === 200, 'email matches ignoring upper/lower case');

  // ---- lockout and counter reset
  const sc = { email: 'lock.a@fds.test', password: 'Sunrise-Lock-2026' };
  const [{ property_id }] = await db.q('select property_id from properties limit 1');
  await db.q("insert into users(property_id,role_id,full_name,email,password_hash) values($1,3,'Lock Subject',$2,$3)", [property_id, sc.email, await hashPassword(sc.password)]);
  for (let i = 0; i < 4; i++) await login(sc, 'Wrong-Password-1');
  ok((await login(sc)).status === 200, '4 wrong passwords then the right one: signs in');
  for (let i = 0; i < 4; i++) await login(sc, 'Wrong-Password-1');
  ok((await login(sc)).status === 200, 'the counter reset on success: 4 more wrong then right still works');
  for (let i = 0; i < 5; i++) await login(sc, 'Wrong-Password-1');
  const lk = await login(sc);
  ok(lk.status === 429 && lk.body.error.code === 'ACCOUNT_LOCKED' && /15 minute/.test(lk.body.error.message), 'the 5th wrong password locks the account for 15 minutes');
  ok((await db.q("select 1 x from audit_records where action='ACCOUNT_LOCKED'")).length >= 1, 'the lock is written to the audit log');
  await db.q("update users set locked_until = now() - interval '1 minute' where email=$1", [sc.email]);
  ok((await login(sc)).status === 200, 'after the lock time passes, the account works again');

  // ---- sessions list and revoke
  const a = (await login(fd)).body.token, b = (await login(fd)).body.token;
  const list = (await api('GET', '/api/sessions', null, a)).body;
  ok(list.length >= 2 && list.filter(s => s.current).length === 1 && list.every(s => !('token_hash' in s)), 'GET /api/sessions lists my active sessions, marks the current one, shows no secrets');
  const other = list.find(s => !s.current);
  const del = await api('DELETE', `/api/sessions/${other.session_id}`, null, a);
  ok(del.status === 200 && (await api('GET', '/api/sessions', null, a)).body.every(s => s.session_id !== other.session_id), 'DELETE /api/sessions/:id ends one of my sessions');
  ok((await api('DELETE', `/api/sessions/${other.session_id}`, null, a)).status === 404, 'ending it twice gives 404');
  const mgrSession = (await api('GET', '/api/sessions', null, 'manager')).body[0];
  ok((await api('DELETE', `/api/sessions/${mgrSession.session_id}`, null, a)).status === 404, 'I cannot end someone else\'s session (404, as if it did not exist)');
  ok((await api('GET', '/api/me', null, 'manager')).status === 200, 'and the other user\'s session still works');
  const c = (await login(fd)).body.token;
  const ro = await api('POST', '/api/sessions/revoke-others', null, c);
  ok(ro.status === 200 && ro.body.revoked >= 1 && (await api('GET', '/api/me', null, c)).status === 200 && (await api('GET', '/api/me', null, a)).body.error.code === 'SESSION_REVOKED', 'revoke-others ends every other session and keeps this one');
  ok((await api('GET', '/api/sessions')).status === 401 && (await api('POST', '/api/sessions/revoke-others')).status === 401, 'session endpoints need a sign-in');

  // ---- expired sessions disappear from the list; last_seen refresh
  const e1 = (await login(fd)).body.token;
  await db.q("update user_sessions set expires_at = now() - interval '1 minute' where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')", [e1]);
  ok((await api('GET', '/api/me', null, e1)).body.error.code === 'SESSION_EXPIRED', 'expired session: SESSION_EXPIRED');
  ok((await api('GET', '/api/me', null, e1)).body.error.code === 'SESSION_REVOKED', 'and it is marked ended afterwards');
  const [{ revoked_reason }] = await db.q("select revoked_reason from user_sessions where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')", [e1]);
  ok(revoked_reason === 'EXPIRED', 'the reason EXPIRED is recorded');
  const f1 = (await login(fd)).body.token;
  await db.q("update user_sessions set last_seen_at = now() - interval '30 minutes' where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')", [f1]);
  await api('GET', '/api/me', null, f1);
  const [{ fresh }] = await db.q("select (last_seen_at > now() - interval '1 minute') fresh from user_sessions where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')", [f1]);
  ok(fresh, 'activity refreshes the idle timer (30 minutes idle, then used: refreshed)');

  // ---- changes in the database apply on the very next request
  const d1 = (await login(fd)).body.token;
  await db.q('update users set is_active=false where email=$1', [fd.email]);
  const dd = await api('GET', '/api/me', null, d1);
  ok(dd.status === 401 && dd.body.error.code === 'SESSION_REVOKED', 'a deactivated user is refused on the very next request');
  await db.q('update users set is_active=true where email=$1', [fd.email]);
  const m1 = (await login(DEMO.manager)).body.token;
  await db.q("update users set role_id=3 where email=$1", [DEMO.manager.email]);
  ok((await api('POST', '/api/rates', {}, m1)).status === 403, 'a role change applies immediately (Manager demoted to Front Desk: now 403)');
  await db.q("update users set role_id=2 where email=$1", [DEMO.manager.email]);
  ok((await api('GET', '/api/rates', null, m1)).status === 200 && (await api('GET', '/api/me', null, m1)).body.role === 'OWNER_MANAGER', 'and restoring the role applies immediately too');
  // no secrets in any response
  const me = (await api('GET', '/api/me', null, m1)).body;
  ok(!JSON.stringify(me).match(/hash|password/i), 'GET /api/me shows no password data');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
