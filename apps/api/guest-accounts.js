// Guest accounts for the direct booking website (migration 009).
// - Separate from staff users: a guest token is only accepted on /api/public/account/... and when starting a booking.
// - Passwords use the same scrypt hashing and password rules as staff (password.js).
// - Sessions: a random token is returned once; only its SHA-256 is stored. 8 hours, ended by logout.
// - 5 wrong passwords in a row lock the account for 15 minutes. Unknown email and wrong password give the same answer.
// - "My bookings" lists only bookings started while signed in to the account (never matched by e-mail: e-mail is not verified yet).
const crypto = require('crypto');
const { HttpError, unauthenticated, conflict, Fields } = require('./errors');
const { hashPassword, verifyPassword, needsRehash, verifyDummy, validatePassword } = require('./password');
const S = require('./service');

const TTL_HOURS = 8, MAX_FAILS = 5, LOCK_MINUTES = 15;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()\-]{5,28}$/;
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const view = a => ({ account_id: a.account_id, full_name: a.full_name, email: a.email, phone: a.phone || null, created_at: a.created_at });

module.exports = function mountGuestAccounts(app, { db, q, wrap, limit, propertyOf }) {
  async function startSession(qq, account) {
    const token = crypto.randomBytes(32).toString('base64url');
    const [s] = await qq('insert into guest_account_sessions(account_id, token_hash, expires_at) values($1,$2, now() + make_interval(hours => $3)) returning expires_at',
      [account.account_id, sha256(token), TTL_HOURS]);
    return { token, expires_at: s.expires_at, account: view(account) };
  }

  // The signed-in guest, from "Authorization: Bearer <token>". required=false returns null when no token is sent.
  async function accountFromRequest(qq, req, required = true) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) { if (required) throw unauthenticated('Please sign in.'); return null; }
    const [s] = await qq(`select s.session_id, s.revoked_at, (s.expires_at < now()) expired, a.*
      from guest_account_sessions s join guest_accounts a using(account_id) where s.token_hash=$1`, [sha256(m[1])]);
    if (!s) throw unauthenticated('Please sign in again.');
    if (s.revoked_at || !s.is_active) throw unauthenticated('This session was ended. Please sign in again.', 'SESSION_REVOKED');
    if (s.expired) throw unauthenticated('Your session expired. Please sign in again.', 'SESSION_EXPIRED');
    return s;
  }

  app.post('/api/public/account/register', limit('AUTH', 20), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    const name = typeof b.full_name === 'string' ? b.full_name.trim().replace(/\s+/g, ' ') : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const phone = b.phone === undefined || b.phone === null || b.phone === '' ? null : String(b.phone).trim();
    if (name.length < 2 || name.length > 120) f.add('full_name', 'Full name, 2 to 120 characters.');
    if (!EMAIL_RE.test(email) || email.length > 160) f.add('email', 'A valid e-mail address.');
    if (phone !== null && !PHONE_RE.test(phone)) f.add('phone', 'Digits, spaces, + ( ) and - only, 6 to 30 characters.');
    for (const msg of validatePassword(b.password, { email, full_name: name })) f.add('password', msg);
    f.check();
    const p = await propertyOf(b.property_id);
    const hash = await hashPassword(b.password);
    const out = await db().tx(async t => {
      const [dupe] = await t.q('select 1 from guest_accounts where property_id=$1 and lower(email)=$2', [p.property_id, email]);
      if (dupe) throw conflict('An account already exists for this e-mail address. Please sign in.', 'CONFLICT', [{ field: 'email', message: 'Already registered.' }]);
      const [a] = await t.q('insert into guest_accounts(property_id, full_name, email, phone, password_hash) values($1,$2,$3,$4,$5) returning *', [p.property_id, name, email, phone, hash]);
      await S.audit(t.q, null, 'GUEST_ACCOUNT_CREATED', 'guest_accounts', a.account_id, null, { email });
      return startSession(t.q, a);
    });
    res.status(201).json(out);
  }));

  app.post('/api/public/account/login', limit('AUTH', 20), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    if (typeof b.email !== 'string' || !b.email.trim()) f.add('email', 'Email is required.');
    if (typeof b.password !== 'string' || !b.password) f.add('password', 'Password is required.');
    f.check();
    const p = await propertyOf(b.property_id);
    const [a] = await q(`select *, (locked_until > now()) locked, ceil(extract(epoch from (locked_until - now())) / 60)::int lock_minutes
      from guest_accounts where property_id=$1 and lower(email)=lower($2)`, [p.property_id, b.email.trim()]);
    if (!a) { await verifyDummy(b.password); throw unauthenticated('Wrong email or password.', 'INVALID_CREDENTIALS'); }
    if (a.locked) throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${a.lock_minutes} minute(s).`);
    if (!(await verifyPassword(b.password, a.password_hash))) {
      const [r] = await q('update guest_accounts set failed_login_count = failed_login_count + 1 where account_id=$1 returning failed_login_count', [a.account_id]);
      if (r.failed_login_count >= MAX_FAILS) await q('update guest_accounts set failed_login_count=0, locked_until = now() + make_interval(mins => $2) where account_id=$1', [a.account_id, LOCK_MINUTES]);
      throw unauthenticated('Wrong email or password.', 'INVALID_CREDENTIALS');
    }
    if (!a.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Please contact the hotel.');
    await q('update guest_accounts set failed_login_count=0, locked_until=null, last_login_at=now() where account_id=$1', [a.account_id]);
    if (needsRehash(a.password_hash)) await q('update guest_accounts set password_hash=$2 where account_id=$1', [a.account_id, await hashPassword(b.password)]);
    res.json(await startSession(q, a));
  }));

  app.post('/api/public/account/logout', wrap(async (req, res) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m) await q('update guest_account_sessions set revoked_at=now() where token_hash=$1 and revoked_at is null', [sha256(m[1])]);
    res.json({ ok: true });
  }));

  app.get('/api/public/account', limit('READ', 120), wrap(async (req, res) => {
    res.json(view(await accountFromRequest(q, req)));
  }));

  app.get('/api/public/account/bookings', limit('READ', 120), wrap(async (req, res) => {
    const a = await accountFromRequest(q, req);
    await S.sweepHolds(q);
    const rows = await q(`select b.attempt_id, b.status, b.check_in_date::text check_in, b.check_out_date::text check_out, b.total_guests, b.total::float8 total, b.currency_code,
        b.created_at, t.name room_type, r.reservation_ref, r.status reservation_status
      from booking_attempts b join room_types t using(room_type_id) left join reservations r on r.reservation_id=b.reservation_id
      where b.account_id=$1 and b.status not in ('ABANDONED','EXPIRED','FAILED') order by b.check_in_date desc, b.created_at desc limit 100`, [a.account_id]);
    res.json(rows);
  }));

  return { accountFromRequest };
};
