// Guest accounts for the direct booking website (migration 009): sign up, sign in, my bookings, and the line between guest and staff tokens.
process.env.PUBLIC_LIMIT_BOOK = '1000'; process.env.PUBLIC_LIMIT_READ = '1000'; process.env.PUBLIC_LIMIT_AUTH = '1000';
const crypto = require('crypto');
const { ok, summary, boot, api, tok } = require('./helpers');
const S = require('../service');

(async () => {
  await boot();
  const db = await require('../db').connect();
  const t = S.today(), D = n => S.addDays(t, n);
  const code = r => r.body && r.body.error && r.body.error.code;
  const fields = r => ((r.body.error || {}).fields || []).map(f => f.field).sort().join();
  const bearer = token => ({ Authorization: 'Bearer ' + token });
  const pub = (m, u, b, headers = {}) => api(m, u, b, undefined, headers);
  const PW = 'Harbour-Stay-2026';

  // ---- register ----
  const reg = await pub('POST', '/api/public/account/register', { full_name: 'Aina  Rahman', email: 'Aina@Example.TEST', phone: '+60 12-000 0000', password: PW });
  ok(reg.status === 201 && reg.body.token && reg.body.account.email === 'aina@example.test' && reg.body.account.full_name === 'Aina Rahman', 'register: 201 with a token; e-mail lower-cased and name spaces tidied');
  ok(!('password_hash' in reg.body.account), 'register: the answer never contains the password hash');
  const [row] = await db.q("select password_hash from guest_accounts where email='aina@example.test'");
  ok(row && row.password_hash.startsWith('scrypt$') && !row.password_hash.includes(PW), 'register: the password is stored as a scrypt hash, not as text');
  const dupe = await pub('POST', '/api/public/account/register', { full_name: 'Someone Else', email: 'AINA@example.test', password: PW });
  ok(dupe.status === 409 && code(dupe) === 'CONFLICT', 'register: the same e-mail (any upper/lower case) cannot register twice');
  const badReg = await pub('POST', '/api/public/account/register', { full_name: 'A', email: 'not-an-email', phone: 'call me', password: 'short' });
  ok(badReg.status === 400 && [...new Set(fields(badReg).split(','))].join() === 'email,full_name,password,phone', 'register: name, e-mail, phone and password rules are checked together');
  ok(code(await pub('POST', '/api/public/account/register', { full_name: 'Weak Pass', email: 'weak@example.test', password: 'password123' })) === 'VALIDATION_ERROR', 'register: a common password is refused');

  // ---- me / login / logout ----
  const me = await pub('GET', '/api/public/account', null, bearer(reg.body.token));
  ok(me.status === 200 && me.body.email === 'aina@example.test', 'me: the token from register works');
  ok((await pub('GET', '/api/public/account')).status === 401, 'me: no token is 401');
  ok((await pub('GET', '/api/public/account', null, bearer('made-up'))).status === 401, 'me: an unknown token is 401');
  const wrong = await pub('POST', '/api/public/account/login', { email: 'aina@example.test', password: 'Wrong-Pass-2026' });
  const nobody = await pub('POST', '/api/public/account/login', { email: 'nobody@example.test', password: PW });
  ok(wrong.status === 401 && nobody.status === 401 && code(wrong) === 'INVALID_CREDENTIALS' && wrong.body.error.message === nobody.body.error.message, 'login: wrong password and unknown e-mail give the same answer');
  const login = await pub('POST', '/api/public/account/login', { email: 'AINA@example.test', password: PW });
  ok(login.status === 200 && login.body.token && login.body.token !== reg.body.token, 'login: works with any upper/lower case e-mail and gives a new token');
  await pub('POST', '/api/public/account/logout', {}, bearer(reg.body.token));
  const ended = await pub('GET', '/api/public/account', null, bearer(reg.body.token));
  ok(ended.status === 401 && code(ended) === 'SESSION_REVOKED', 'logout: the ended token is refused with SESSION_REVOKED');
  ok((await pub('GET', '/api/public/account', null, bearer(login.body.token))).status === 200, 'logout: other sessions of the same account keep working');
  await db.q("update guest_account_sessions set expires_at = now() - interval '1 minute' where token_hash = $1", [crypto.createHash('sha256').update(login.body.token).digest('hex')]);
  ok(code(await pub('GET', '/api/public/account', null, bearer(login.body.token))) === 'SESSION_EXPIRED', 'session: an expired token is refused with SESSION_EXPIRED');

  // ---- lockout ----
  await pub('POST', '/api/public/account/register', { full_name: 'Lock Test', email: 'lock@example.test', password: PW });
  for (let i = 0; i < 5; i++) await pub('POST', '/api/public/account/login', { email: 'lock@example.test', password: 'Wrong-Pass-2026' });
  const locked = await pub('POST', '/api/public/account/login', { email: 'lock@example.test', password: PW });
  ok(locked.status === 429 && code(locked) === 'ACCOUNT_LOCKED', 'lockout: 5 wrong passwords lock the account, even for the right password');

  // ---- guest and staff tokens do not mix ----
  const guest = (await pub('POST', '/api/public/account/login', { email: 'aina@example.test', password: PW })).body.token;
  ok((await api('GET', '/api/me', null, guest)).status === 401 && (await api('GET', '/api/reservations', null, guest)).status === 401, 'a guest token is refused on staff endpoints');
  ok((await pub('GET', '/api/public/account', null, bearer(tok.admin))).status === 401, 'a staff token is refused on guest endpoints');

  // ---- bookings made while signed in ----
  const twin = (await api('GET', '/api/room-types', null, 'frontdesk')).body.find(x => x.name === 'Standard Twin').room_type_id;
  const stay = (from, to, email) => ({ room_type_id: twin, check_in: from, check_out: to, total_guests: 2, guest: { full_name: 'Aina Rahman', email, phone: '+60 12-000 0000' } });
  const signedIn = await pub('POST', '/api/public/bookings', stay(D(30), D(32), 'aina@example.test'), bearer(guest));
  ok(signedIn.status === 201, 'booking: a signed-in guest can book');
  const anon = await pub('POST', '/api/public/bookings', stay(D(33), D(34), 'aina@example.test'));
  ok(anon.status === 201, 'booking: booking without signing in still works');
  const mine = await pub('GET', '/api/public/account/bookings', null, bearer(guest));
  ok(mine.status === 200 && mine.body.length === 1 && mine.body[0].attempt_id === signedIn.body.attempt_id && mine.body[0].room_type === 'Standard Twin' && mine.body[0].check_in === D(30),
    'my bookings: shows the booking made while signed in, and not the one made signed out with the same e-mail');
  const other = (await pub('POST', '/api/public/account/register', { full_name: 'Other Guest', email: 'other@example.test', password: PW })).body.token;
  ok((await pub('GET', '/api/public/account/bookings', null, bearer(other))).body.length === 0, 'my bookings: another account sees none of them');
  const badTok = await pub('POST', '/api/public/bookings', stay(D(35), D(36), 'aina@example.test'), bearer('made-up'));
  ok(badTok.status === 401, 'booking: an unknown guest token is refused instead of silently booking without the account');
  await pub('POST', `/api/public/bookings/${signedIn.body.attempt_id}/cancel`, {}, { 'X-Booking-Token': signedIn.body.access_token });
  ok((await pub('GET', '/api/public/account/bookings', null, bearer(guest))).body.length === 0, 'my bookings: an abandoned booking is left out');

  // ---- the AI read-only role cannot see the new tables (nothing is granted on them) ----
  const grants = await db.q("select count(*)::int n from information_schema.role_table_grants where table_name in ('guest_accounts','guest_account_sessions') and grantee='fds_ai_readonly'");
  ok(grants[0].n === 0, 'no grant on guest accounts or their sessions for the AI read-only role');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
