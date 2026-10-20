// Authentication, sessions and revocation (S056).
// - Passwords: scrypt (password.js). Unknown email and wrong password give the same answer and take similar time.
// - Sessions: random 256-bit token returned once; only its SHA-256 is stored. Sessions live in user_sessions,
//   so they survive a restart and can be revoked from the server at any time.
// - Lockout: 5 wrong passwords in a row lock the account for 15 minutes.
// - The user's role is read from the database on EVERY request, so a role change or deactivation applies immediately.
const crypto = require('crypto');
const { HttpError, unauthenticated, Fields } = require('./errors');
const { verifyPassword, hashPassword, needsRehash, verifyDummy } = require('./password');
const { audit } = require('./service');

const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 8);        // absolute lifetime
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 60); // no activity for this long ends the session
const MAX_FAILS = 5, LOCK_MINUTES = 15;
const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const publicUser = u => ({ user_id: u.user_id, name: u.full_name, email: u.email, role: u.role, can_approve_rates: u.can_approve_rates, property_id: u.property_id });

// Count a wrong password; lock the account after MAX_FAILS in a row. Returns true when this attempt locked it.
async function registerFailedAttempt(q, userId) {
  const [r] = await q('update users set failed_login_count = failed_login_count + 1 where user_id=$1 returning failed_login_count', [userId]);
  if (r.failed_login_count < MAX_FAILS) return false;
  await q('update users set failed_login_count=0, locked_until = now() + make_interval(mins => $2) where user_id=$1', [userId, LOCK_MINUTES]);
  await audit(q, userId, 'ACCOUNT_LOCKED', 'users', userId, null, { minutes: LOCK_MINUTES });
  return true;
}

async function login(db, { email, password }, userAgent) {
  const f = new Fields();
  if (typeof email !== 'string' || !email.trim()) f.add('email', 'Email is required.');
  if (typeof password !== 'string' || !password) f.add('password', 'Password is required.');
  f.check();
  const q = db.q;
  const [u] = await q(`select u.user_id, u.property_id, u.full_name, u.email, u.password_hash, u.can_approve_rates, u.is_active, u.locked_until,
      (u.locked_until > now()) as locked, ceil(extract(epoch from (u.locked_until - now())) / 60)::int as lock_minutes, r.name role
    from users u join roles r using(role_id) where lower(u.email)=lower($1)`, [email.trim()]);
  if (!u) { await verifyDummy(password); throw unauthenticated('Wrong email or password.', 'INVALID_CREDENTIALS'); }
  if (u.locked) throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${u.lock_minutes} minute(s).`);

  if (!(await verifyPassword(password, u.password_hash))) {
    await registerFailedAttempt(q, u.user_id);
    throw unauthenticated('Wrong email or password.', 'INVALID_CREDENTIALS');
  }
  if (!u.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Ask an administrator.');

  await q('update users set failed_login_count=0, locked_until=null, last_login_at=now() where user_id=$1', [u.user_id]);
  if (needsRehash(u.password_hash)) await q('update users set password_hash=$2 where user_id=$1', [u.user_id, await hashPassword(password)]);
  const token = crypto.randomBytes(32).toString('base64url');
  const [s] = await q(`insert into user_sessions(user_id, token_hash, expires_at, user_agent) values($1,$2, now() + make_interval(hours => $3), $4)
                       returning session_id, expires_at`, [u.user_id, sha256(token), TTL_HOURS, (userAgent || '').slice(0, 200) || null]);
  await audit(q, u.user_id, 'SESSION_CREATED', 'user_sessions', s.session_id, null, null);
  return { token, expires_at: s.expires_at, user: publicUser(u) };
}

// Express middleware: every request is checked against the database.
const authenticate = db => async (req, res, next) => {
  try {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) throw unauthenticated();
    const [s] = await db.q(`select s.session_id, s.revoked_at, u.user_id, u.property_id, u.full_name, u.email, u.can_approve_rates, u.is_active, r.name role,
        (s.expires_at < now()) as expired, (s.last_seen_at < now() - make_interval(mins => $2)) as idle, (s.last_seen_at < now() - interval '60 seconds') as stale
      from user_sessions s join users u using(user_id) join roles r on r.role_id=u.role_id where s.token_hash=$1`, [sha256(m[1]), IDLE_MINUTES]);
    if (!s) throw unauthenticated();
    if (s.revoked_at || !s.is_active) throw unauthenticated('This session was ended. Please sign in again.', 'SESSION_REVOKED');
    if (s.expired || s.idle) {
      await db.q(`update user_sessions set revoked_at=now(), revoked_reason='EXPIRED' where session_id=$1`, [s.session_id]);
      throw unauthenticated('Your session expired. Please sign in again.', 'SESSION_EXPIRED');
    }
    if (s.stale) await db.q('update user_sessions set last_seen_at=now() where session_id=$1', [s.session_id]);
    req.user = { user_id: s.user_id, property_id: s.property_id, name: s.full_name, email: s.email, role: s.role, can_approve_rates: s.can_approve_rates };
    req.session_id = s.session_id;
    next();
  } catch (e) { next(e); }
};

// Revoke every active session of a user (optionally keeping one). Returns how many were ended.
async function revokeSessions(q, userId, reason, exceptSessionId, onlySessionId) {
  const rows = await q(`update user_sessions set revoked_at=now(), revoked_reason=$2
    where user_id=$1 and revoked_at is null and ($3::uuid is null or session_id <> $3::uuid) and ($4::uuid is null or session_id = $4::uuid) returning session_id`,
    [userId, reason, exceptSessionId || null, onlySessionId || null]);
  return rows.length;
}
module.exports = { login, authenticate, revokeSessions, registerFailedAttempt, publicUser, TTL_HOURS, IDLE_MINUTES, MAX_FAILS, LOCK_MINUTES };
