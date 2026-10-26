// The FDS web app (apps/fds-web) endpoints: cookie sign-in, /api/auth/*, /api/staff*, string errors, role names.
const { ok, summary, boot, api, DEMO } = require('./helpers');
const { spawnSync } = require('child_process'), path = require('path');
const H = { 'X-App-Request': '1' };
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
const signIn = async u => { const r = await api('POST', '/api/auth/login', { email: u.email, password: u.password }); return { r, cookie: cookieOf(r) }; };
const as = (cookie, extra = {}) => ({ Cookie: cookie, ...extra });

(async () => {
  await boot(); const db = await require('../db').connect();

  // ---- setup state on a seeded database
  const st = await api('GET', '/api/auth/setup');
  ok(st.status === 200 && st.body.setupRequired === false, 'GET /api/auth/setup: setup is not required when users exist');
  const again = await api('POST', '/api/auth/setup', { name: 'Late Admin', email: 'late@fds.test', password: 'Maple-River-2026', confirm: 'Maple-River-2026' });
  ok(again.status === 409 && again.body.error === 'Setup has already been completed.' && again.body.code === 'CONFLICT', 'POST /api/auth/setup is refused once any user exists (409, plain-text error)');
  ok((await db.q("select 1 x from users where email='late@fds.test'")).length === 0, 'and nothing was created');

  // ---- sign in
  const { r: login, cookie: admin } = await signIn(DEMO.admin);
  const sc = login.headers.get('set-cookie') || '';
  ok(login.status === 200 && login.body.user.role === 'admin' && login.body.user.name === 'Administrator' && login.body.user.status === 'active' && login.body.user.phone === '' && !!login.body.user.id, 'login: the user comes back in the web app shape (role admin, status active)');
  ok(/^fds_session=[A-Za-z0-9_-]{40,}/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\//.test(sc) && /Max-Age=28800/.test(sc) && !/Secure/.test(sc), 'the session cookie is HttpOnly, SameSite=Lax, 8 hours, no Secure over plain http');
  ok(!('token' in login.body) && !JSON.stringify(login.body).includes(admin.split('=')[1]), 'the token is not in the response body (only in the HttpOnly cookie)');
  ok((await api('POST', '/api/auth/login', { email: DEMO.manager.email, password: DEMO.manager.password })).body.user.role === 'manager' && (await signIn(DEMO.frontdesk)).r.body.user.role === 'front_desk', 'role names: manager and front_desk');
  const wrong = await api('POST', '/api/auth/login', { email: DEMO.admin.email, password: 'Wrong-Password-1' });
  ok(wrong.status === 401 && wrong.body.error === 'Wrong email or password.' && wrong.body.code === 'INVALID_CREDENTIALS' && !!wrong.body.request_id, 'wrong password: 401 with a plain-text error string (the web app shows body.error directly)');
  ok(!(wrong.headers.get('set-cookie')), 'and no cookie is set');
  const empty = await api('POST', '/api/auth/login', {});
  ok(empty.status === 400 && typeof empty.body.error === 'string' && /required/i.test(empty.body.error), 'empty login: 400, text error');

  // ---- session
  const none = await api('GET', '/api/auth/session');
  ok(none.status === 200 && none.body.user === null, 'GET /api/auth/session with no cookie: 200 { user: null }, not 401');
  ok((await api('GET', '/api/auth/session', null, null, as('fds_session=garbage'))).body.user === null, 'a made-up cookie: { user: null }');
  const sess = await api('GET', '/api/auth/session', null, null, as(admin));
  ok(sess.status === 200 && sess.body.user.email === DEMO.admin.email && sess.body.user.role === 'admin', 'with the cookie: the signed-in user');
  ok((await api('GET', '/api/me', null, null, as(admin))).body.email === DEMO.admin.email, 'the cookie also works on the main API endpoints');
  ok((await api('POST', '/api/auth/login', { email: DEMO.admin.email, password: DEMO.admin.password }, null, as('fds_session=garbage'))).status === 200, 'login ignores a stale cookie');

  // ---- cookie requests that change data must carry X-App-Request
  const noHdr = await api('POST', '/api/staff', { name: 'No Header', email: 'noh@fds.test', role: 'front_desk', password: 'Maple-River-2026' }, null, as(admin));
  ok(noHdr.status === 403 && /X-App-Request/.test(noHdr.body.error), 'a cookie POST without X-App-Request is refused (403)');
  ok((await db.q("select 1 x from users where email='noh@fds.test'")).length === 0, 'and nothing was created');
  ok((await api('POST', '/api/rates/' + '00000000-0000-4000-8000-000000000000' + '/approve', null, 'admin')).status === 404, 'a Bearer request needs no such header (unchanged for the main API)');

  // ---- staff list
  const list = await api('GET', '/api/staff', null, null, as(admin));
  ok(list.status === 200 && Array.isArray(list.body.users) && list.body.users.length === 3 && list.body.users.every(u => u.id && u.name && u.email && ['admin', 'manager', 'front_desk'].includes(u.role) && ['active', 'disabled'].includes(u.status) && typeof u.phone === 'string'), 'GET /api/staff: { users: [...] } in the web app shape');
  ok(!JSON.stringify(list.body).match(/hash|password|token/i), 'no password data in the list');
  const mgr = (await signIn(DEMO.manager)).cookie, fd = (await signIn(DEMO.frontdesk)).cookie;
  ok((await api('GET', '/api/staff', null, null, as(mgr))).status === 200, 'a Manager can list staff');
  const fdList = await api('GET', '/api/staff', null, null, as(fd));
  ok(fdList.status === 403 && typeof fdList.body.error === 'string', 'Front Desk cannot: 403 with a text error');
  ok((await api('GET', '/api/staff')).status === 401, 'no cookie: 401');

  // ---- create
  const mk = (o = {}) => ({ name: 'Lena Park', email: 'Lena.Park@FDS.test', phone: '012-345 6789', role: 'front_desk', status: 'active', password: 'Maple-River-2026', ...o });
  const c1 = await api('POST', '/api/staff', mk(), null, as(admin, H));
  ok(c1.status === 201 && c1.body.user.email === 'lena.park@fds.test' && c1.body.user.phone === '012-345 6789' && c1.body.user.role === 'front_desk' && c1.body.user.status === 'active', 'create: 201, { user } in the web app shape, email lower-cased, phone saved');
  ok((await signIn({ email: 'lena.park@fds.test', password: 'Maple-River-2026' })).r.status === 200, 'the new person can sign in with that password');
  const weak = await api('POST', '/api/staff', mk({ email: 'weak.one@fds.test', name: 'Weak One', password: 'short' }), null, as(admin, H));
  ok(weak.status === 400 && /at least 10 characters/.test(weak.body.error) && /number/.test(weak.body.error) && weak.body.fields.length === 2, 'weak password: one text error that lists every problem, plus fields[]');
  const badRole = await api('POST', '/api/staff', mk({ email: 'r@fds.test', role: 'ADMINISTRATOR' }), null, as(admin, H));
  ok(badRole.status === 400 && /Choose a valid role/.test(badRole.body.error), 'a main-API role name is not a web app role: 400 "Choose a valid role."');
  const dup = await api('POST', '/api/staff', mk({ email: 'LENA.PARK@fds.test' }), null, as(admin, H));
  ok(dup.status === 409 && /already used/.test(dup.body.error) && dup.body.code === 'CONFLICT', 'duplicate email (other letter case): 409 text error');
  ok((await api('POST', '/api/staff', mk({ email: 'mgr.new@fds.test', role: 'manager', name: 'Omar Lee' }), null, as(mgr, H))).status === 403, 'a Manager cannot create a manager (SRS reading: Front Desk accounts only)');
  const mfd = await api('POST', '/api/staff', mk({ email: 'kai.o@fds.test', name: 'Kai Ong', password: 'River-Stone-2026' }), null, as(mgr, H));
  ok(mfd.status === 201, 'a Manager can create a Front Desk account');
  ok((await api('POST', '/api/staff', mk({ email: 'x.y@fds.test' }), null, as(fd, H))).status === 403, 'Front Desk cannot create accounts');
  const adm = await api('POST', '/api/staff', mk({ email: 'sara.w@fds.test', name: 'Sara Wu', role: 'admin', password: 'Harbor-Wind-2026' }), null, as(admin, H));
  ok(adm.status === 201 && adm.body.user.role === 'admin', 'an Administrator can create an admin');

  // ---- edit
  const id = c1.body.user.id, lena = (await signIn({ email: 'lena.park@fds.test', password: 'Maple-River-2026' })).cookie;
  const e1 = await api('PATCH', `/api/staff/${id}`, { id, name: 'Lena Q Park', email: 'LENA.PARK@fds.test', phone: '', role: 'front_desk', status: 'active' }, null, as(admin, H));
  ok(e1.status === 200 && e1.body.user.name === 'Lena Q Park' && e1.body.user.phone === '' && e1.body.user.email === 'lena.park@fds.test', 'edit: name changed, phone cleared, the same email in other letter case is accepted');
  ok((await api('GET', '/api/auth/session', null, null, as(lena))).body.user !== null, 'renaming does not end her session');
  const e2 = await api('PATCH', `/api/staff/${id}`, { name: 'Lena Q Park', email: 'other@fds.test', role: 'front_desk', status: 'active' }, null, as(admin, H));
  ok(e2.status === 400 && /email address is not supported/.test(e2.body.error), 'a changed email is refused with a clear message');
  const e3 = await api('PATCH', `/api/staff/${id}`, { name: 'Lena Q Park', email: 'lena.park@fds.test', role: 'front_desk', status: 'pending' }, null, as(admin, H));
  ok(e3.status === 400 && /Pending approval is not supported/.test(e3.body.error), 'status pending is refused with a clear message');
  ok((await api('PATCH', `/api/staff/${id}`, { status: 'frozen' }, null, as(admin, H))).status === 400 && (await api('PATCH', `/api/staff/${id}`, { role: 'king' }, null, as(admin, H))).status === 400, 'unknown status or role: 400');
  const off = await api('PATCH', `/api/staff/${id}`, { name: 'Lena Q Park', email: 'lena.park@fds.test', phone: '', role: 'front_desk', status: 'disabled' }, null, as(mgr, H));
  ok(off.status === 200 && off.body.user.status === 'disabled', 'a Manager can disable a Front Desk account');
  const gone = await api('GET', '/api/auth/session', null, null, as(lena));
  ok(gone.status === 200 && gone.body.user === null, 'her open session ends at once (session answers { user: null })');
  const dis = await api('POST', '/api/auth/login', { email: 'lena.park@fds.test', password: 'Maple-River-2026' });
  ok(dis.status === 403 && dis.body.code === 'ACCOUNT_DISABLED' && typeof dis.body.error === 'string', 'a disabled account cannot sign in: 403 text error');
  ok((await api('PATCH', `/api/staff/${id}`, { status: 'active' }, null, as(mgr, H))).status === 200, 'and can be enabled again');
  const adminId = list.body.users.find(u => u.role === 'admin').id;
  const self = await api('PATCH', `/api/staff/${adminId}`, { name: 'Administrator', email: DEMO.admin.email, role: 'admin', status: 'disabled' }, null, as(admin, H));
  ok(self.status === 409 && /own account/.test(self.body.error), 'an Administrator cannot disable their own account (409)');
  const selfSame = await api('PATCH', `/api/staff/${adminId}`, { name: 'Administrator', email: DEMO.admin.email, phone: '', role: 'admin', status: 'active' }, null, as(admin, H));
  ok(selfSame.status === 200, 'saving your own account unchanged (what the form sends) works');
  ok((await api('PATCH', `/api/staff/${adminId}`, { name: 'Hacked', email: DEMO.admin.email, role: 'admin', status: 'active' }, null, as(mgr, H))).status === 403, 'a Manager cannot edit an Administrator');
  ok((await api('PATCH', `/api/staff/00000000-0000-4000-8000-000000000000`, { name: 'Nobody' }, null, as(admin, H))).status === 404, 'unknown id: 404');
  ok((await api('PATCH', `/api/staff/not-a-uuid`, { name: 'Nobody' }, null, as(admin, H))).status === 400, 'an id that is not a UUID: 400');

  // ---- another property cannot be reached
  const [{ property_id }] = await db.q("insert into properties(name,currency_code) values('Other Hotel (demo)','MYR') returning property_id");
  const [o] = await db.q("insert into users(property_id,role_id,full_name,email,password_hash) values($1,3,'Other Person','other.person@fds.test','x') returning user_id", [property_id]);
  ok((await api('PATCH', `/api/staff/${o.user_id}`, { name: 'Hacked Name', email: 'other.person@fds.test' }, null, as(admin, H))).status === 404, 'staff of another property: 404');
  ok(!(await api('GET', '/api/staff', null, null, as(admin))).body.users.some(u => u.email === 'other.person@fds.test'), 'and not in the list');

  // ---- logout
  const lo = await api('POST', '/api/auth/logout', {}, null, as(mgr, H));
  ok(lo.status === 200 && lo.body.message === 'Signed out.' && /fds_session=;/.test(lo.headers.get('set-cookie')) && /Max-Age=0/.test(lo.headers.get('set-cookie')), 'logout: 200 and the cookie is cleared');
  ok((await api('GET', '/api/auth/session', null, null, as(mgr))).body.user === null && (await api('GET', '/api/me', null, null, as(mgr))).status === 401, 'the old cookie no longer works');
  const lo2 = await api('POST', '/api/auth/logout', {});
  ok(lo2.status === 200, 'logging out with no session is harmless (200)');
  const loNoHdr = await api('POST', '/api/auth/logout', {}, null, as(fd));
  ok(loNoHdr.status === 403, 'logout with a cookie but without X-App-Request is refused');
  ok((await api('GET', '/api/auth/session', null, null, as(fd))).body.user !== null, 'and the session is still open');

  // ---- the audit log shows who did what
  const acts = (await api('GET', '/api/audit', null, 'admin')).body.map(a => a.action);
  ok(['USER_CREATED', 'USER_UPDATED', 'SESSION_CREATED'].every(a => acts.includes(a)), 'creating, editing and signing in through the web app endpoints are in the audit log');

  // ---- first administrator on an EMPTY database (own process, nothing seeded)
  const script = `
    process.env.PGLITE_DIR='memory'; process.env.SEED_ON_START='false';
    (async () => {
      const srv = await require(${JSON.stringify(path.join(__dirname, '..', 'server'))}).start(0), B = 'http://localhost:' + srv.address().port;
      const call = async (m, u, b, h = {}) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
      const out = {};
      out.state1 = await call('GET', '/api/auth/setup');
      out.mismatch = await call('POST', '/api/auth/setup', { name: 'First Admin', email: 'first@fds.test', password: 'Maple-River-2026', confirm: 'Different-One-2026' });
      out.weak = await call('POST', '/api/auth/setup', { name: 'First Admin', email: 'first@fds.test', password: 'short', confirm: 'short' });
      const [a, b2] = await Promise.all([1, 2].map(i => call('POST', '/api/auth/setup', { name: 'First Admin', email: 'first' + i + '@fds.test', phone: '012-000 0000', password: 'Maple-River-2026', confirm: 'Maple-River-2026' })));
      out.race = [a.status, b2.status].sort();
      out.state2 = await call('GET', '/api/auth/setup');
      const email = a.status === 201 ? 'first1@fds.test' : 'first2@fds.test';
      out.login = await call('POST', '/api/auth/login', { email, password: 'Maple-River-2026' });
      out.staff = await call('GET', '/api/staff', null, { Cookie: out.login.cookie });
      console.log('RESULT' + JSON.stringify(out)); process.exit(0);
    })().catch(e => { console.error(e); process.exit(1); });`;
  // On a real PostgreSQL server (DATABASE_URL set) the child process gets its own new, empty database.
  const childEnv = { ...process.env }; let dropEmpty = async () => {};
  if (process.env.DATABASE_URL) {
    const { Client } = require('pg'), u = new URL(process.env.DATABASE_URL), name = 'fds_empty_' + process.pid;
    const admin = new Client({ connectionString: process.env.DATABASE_URL }); await admin.connect(); await admin.query(`create database ${name}`);
    u.pathname = '/' + name; childEnv.DATABASE_URL = u.toString();
    dropEmpty = async () => { await admin.query(`drop database ${name} with (force)`); await admin.end(); };
  }
  const run = spawnSync('node', ['-e', script], { encoding: 'utf8', timeout: 120000, env: childEnv });
  await dropEmpty();
  const m = /RESULT(.*)/.exec(run.stdout || ''); const R = m ? JSON.parse(m[1]) : {};
  if (!m) console.log(run.stdout, run.stderr);
  ok(R.state1 && R.state1.body.setupRequired === true, 'empty database: setupRequired is true');
  ok(R.mismatch && R.mismatch.status === 400 && /do not match/.test(R.mismatch.body.error), 'setup: passwords that differ are refused');
  ok(R.weak && R.weak.status === 400 && /at least 10 characters/.test(R.weak.body.error), 'setup: the password rules apply');
  ok(R.race && JSON.stringify(R.race) === '[201,409]', 'two setups at the same moment: exactly one is created, the other gets 409');
  ok(R.state2 && R.state2.body.setupRequired === false, 'after setup, setupRequired is false');
  ok(R.login && R.login.status === 200 && R.login.body.user.role === 'admin' && R.login.body.user.phone === '012-000 0000', 'the first administrator can sign in (role admin, phone saved)');
  ok(R.staff && R.staff.status === 200 && R.staff.body.users.length === 1, 'and sees exactly one staff account');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
