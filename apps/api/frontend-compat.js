// Front end compatibility layer for apps/fds-web.
// The FDS web app signs in with a browser cookie and talks to /api/auth/* and /api/staff*, with its own role names
// (admin / manager / front_desk), its own user shape ({id, name, email, phone, role, status}) and errors as a plain string.
// This file translates between that and the main API (/api/login, /api/users, ...), so the rules live in one place:
// every check, audit record and session rule below is the one the main API already enforces.
const A = require('./auth');
const S = require('./service');
const { HttpError, bad, Fields } = require('./errors');
const { hashPassword, validatePassword } = require('./password');

const TO_API = { admin: 'ADMINISTRATOR', manager: 'OWNER_MANAGER', front_desk: 'FRONT_DESK' };
const FROM_API = { ADMINISTRATOR: 'admin', OWNER_MANAGER: 'manager', FRONT_DESK: 'front_desk' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// the user as the web app expects it
const fe = u => ({ id: u.user_id, name: u.full_name, email: u.email, phone: u.phone || '', role: FROM_API[u.role] || u.role,
  status: u.is_active ? 'active' : 'disabled', can_approve_rates: u.can_approve_rates === true });

module.exports = function mountFrontendCompat(app, { getDb, auth, need }) {
  const db = () => getDb();
  const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
  const loadRow = async userId => (await db().q(`select u.user_id, u.full_name, u.email, u.phone, r.name role, u.is_active, u.can_approve_rates
    from users u join roles r using(role_id) where u.user_id=$1`, [userId]))[0];
  const secure = req => process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
  const setCookie = (req, res, value, maxAge) => res.append('Set-Cookie', `${A.COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
  const clearCookie = (req, res) => setCookie(req, res, '', 0);

  // errors on these paths become { error: "plain text", code, fields?, request_id }: the web app shows body.error directly
  app.use(['/api/auth', '/api/staff'], (req, res, next) => {
    const orig = res.json.bind(res);
    res.json = body => {
      if (body && body.error && typeof body.error === 'object') {
        const e = body.error, detail = [...new Set((e.fields || []).map(x => x.message))];
        body = { error: e.code === 'VALIDATION_ERROR' && detail.length ? detail.join(' ') : e.message, code: e.code, ...(e.fields ? { fields: e.fields } : {}), request_id: e.request_id };
      }
      return orig(body);
    };
    next();
  });
  const mapOut = (res, fn) => { const orig = res.json.bind(res); res.json = body => orig(res.statusCode < 400 ? fn(body) : body); };

  // a session check that answers { user: null } instead of 401
  const soft = (req, res, next, onUser) => A.authenticate(db())(req, res, async err => {
    try {
      if (err) { if (err instanceof HttpError && err.status === 401) return onUser(null); return next(err); }
      await onUser(req.user);
    } catch (e) { next(e); }
  });

  // ---------- sign in / out / session ----------
  app.post('/api/auth/login', wrap(async (req, res) => {
    const out = await A.login(db(), req.body || {}, req.get('user-agent'));
    setCookie(req, res, out.token, A.TTL_HOURS * 3600);
    res.json({ user: fe(await loadRow(out.user.user_id)) });                    // the token stays in the HttpOnly cookie, not in the body
  }));
  app.get('/api/auth/session', (req, res, next) => soft(req, res, next, async user => {
    if (!user) { clearCookie(req, res); return res.json({ user: null }); }
    res.json({ user: fe(await loadRow(user.user_id)) });
  }));
  app.post('/api/auth/logout', (req, res, next) => soft(req, res, next, async user => {
    if (user) await db().q("update user_sessions set revoked_at=now(), revoked_reason='LOGOUT' where session_id=$1", [req.session_id]);
    clearCookie(req, res);
    res.json({ message: 'Signed out.' });
  }));

  // ---------- first administrator (only while there are no users at all) ----------
  const noUsers = async run => (await run('select count(*)::int n from users'))[0].n === 0;
  app.get('/api/auth/setup', wrap(async (req, res) => res.json({ setupRequired: await noUsers(db().q) })));
  app.post('/api/auth/setup', wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    const name = typeof b.name === 'string' ? b.name.trim() : '', email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 120) f.add('name', 'Full name must be 2 to 120 characters.');
    if (!EMAIL_RE.test(email) || email.length > 160) f.add('email', 'Enter a valid email address (up to 160 characters).');
    if (b.phone != null && (typeof b.phone !== 'string' || b.phone.trim().length > 30)) f.add('phone', 'Phone number must be 30 characters or fewer.');
    if (b.confirm !== undefined && b.confirm !== b.password) f.add('confirm', 'Passwords do not match.');
    validatePassword(b.password, { email, full_name: name }).forEach(m => f.add('password', m));
    f.check();
    const hash = await hashPassword(b.password);
    await db().tx(async t => {
      await t.q('select pg_advisory_xact_lock(7305)');                              // two setups at the same time: the second one waits, then sees a user
      if (!(await noUsers(t.q))) throw new HttpError(409, 'CONFLICT', 'Setup has already been completed.');
      let [p] = await t.q('select property_id from properties order by created_at limit 1');
      if (!p) [p] = await t.q("insert into properties(name, currency_code) values('My Property', 'MYR') returning property_id");
      const [u] = await t.q(`insert into users(property_id, role_id, full_name, email, password_hash, can_approve_rates, phone)
        values($1, (select role_id from roles where name='ADMINISTRATOR'), $2, $3, $4, true, $5) returning user_id`, [p.property_id, name, email, hash, b.phone ? b.phone.trim() : null]);
      await S.audit(t.q, u.user_id, 'USER_CREATED', 'users', u.user_id, null, { email, role: 'ADMINISTRATOR', first_administrator: true });
    });
    res.status(201).json({ message: 'Initial administrator created. You can now sign in.' });
  }));

  // ---------- staff: translate, then hand over to /api/users so there is one set of rules ----------
  const roleOf = (v, required) => {
    if (v === undefined && !required) return undefined;
    if (!TO_API[v]) throw bad('Please correct the fields listed.', [{ field: 'role', message: 'Choose a valid role.' }]);
    return TO_API[v];
  };
  app.get('/api/staff', (req, res, next) => { mapOut(res, rows => ({ users: rows.map(fe) })); req.url = '/api/users'; next(); });
  app.post('/api/staff', auth, need('users.manage_frontdesk'), (req, res, next) => {
    try {
      const b = req.body || {};
      req.body = { full_name: b.name, email: b.email, phone: b.phone, role: roleOf(b.role, true), password: b.password };
      mapOut(res, u => ({ user: fe(u) })); req.url = '/api/users'; next();
    } catch (e) { next(e); }
  });
  app.patch('/api/staff/:id', auth, need('users.manage_frontdesk'), wrap(async (req, res, next) => {
    const b = req.body || {}, out = {};
    if ('name' in b) out.full_name = b.name;
    if ('phone' in b) out.phone = b.phone;
    if ('role' in b) out.role = roleOf(b.role, true);
    if ('status' in b) {
      if (b.status === 'active') out.is_active = true;
      else if (b.status === 'disabled') out.is_active = false;
      else throw bad('Please correct the fields listed.', [{ field: 'status', message: b.status === 'pending' ? 'Pending approval is not supported by this server. Use Active or Disabled.' : 'Choose a valid account status.' }]);
    }
    if ('email' in b) {                                                          // the main API does not change an email address
      const [t] = await db().q('select email from users where user_id=$1 and property_id=$2', [req.params.id, req.user.property_id]);
      if (t && String(b.email).trim().toLowerCase() !== t.email.toLowerCase())
        throw bad('Please correct the fields listed.', [{ field: 'email', message: 'Changing an email address is not supported yet.' }]);
    }
    req.body = out; mapOut(res, u => ({ user: fe(u) })); req.url = `/api/users/${req.params.id}`; next();
  }));
};
