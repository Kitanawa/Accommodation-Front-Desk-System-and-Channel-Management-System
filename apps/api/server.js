// FDS backend. Follows the API contract in docs/API_CONTRACT.md (S055):
// UUID identifiers, one error shape with codes, X-Request-Id on every response, property-scoped data.
const express = require('express');
const crypto = require('crypto');
const S = require('./service');
const A = require('./auth');
const P = require('./permissions');
const Approvals = require('./approvals');
const { HttpError, bad, forbidden, notFound, conflict, Fields, isUuid } = require('./errors');
const { hashPassword, verifyPassword, validatePassword, POLICY } = require('./password');

let db, s0;
const app = express();
app.use((req, res, next) => {                       // request id + CORS (a separate front end may call this API)
  req.id = crypto.randomUUID();
  res.set({ 'X-Request-Id': req.id, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Booking-Token, X-Signature',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'X-Request-Id, X-Total-Count, X-Page, X-Page-Size, X-Total-Pages' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { if (req.url.startsWith('/api/public/payments/webhook')) req.rawBody = buf; } }));
app.param('id', (req, res, next, v) => isUuid(v) ? next() : next(bad('The id in the URL is not valid.', [{ field: 'id', message: 'Must be a UUID.' }])));

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const q = (s, p) => db.q(s, p);
const auth = (req, res, next) => A.authenticate(db)(req, res, next);
const need = perm => (req, res, next) => P.can(req.user, perm) ? next() : next(forbidden());
const prop = req => req.user.property_id;
const money = n => Math.round(Number(n) * 100) / 100;

// ---------- public ----------
app.get('/', (req, res) => res.json({ name: 'FDS backend (SRS Draft 2)', database: db.mode, contract: 'docs/API_CONTRACT.md', login: 'POST /api/login' }));
app.get('/api/info', (req, res) => res.json({ database: db.mode }));

// ---------- sign in (FR-01) ----------
app.post('/api/login', wrap(async (req, res) => res.json(await A.login(db, req.body || {}, req.get('user-agent')))));
app.post('/api/logout', auth, wrap(async (req, res) => {
  await q("update user_sessions set revoked_at=now(), revoked_reason='LOGOUT' where session_id=$1", [req.session_id]);
  res.json({ ok: true });
}));
app.get('/api/me', auth, (req, res) => res.json(A.publicUser(req.user)));

// ---------- front end (apps/fds-web): cookie sign-in and /api/staff, translated onto the endpoints below ----------
require('./frontend-compat')(app, { getDb: () => db, auth, need });
require('./frontdesk')(app, { getDb: () => db, auth, need, wrap });
require('./guests')(app, { getDb: () => db, auth, need, wrap });
require('./calendar')(app, { getDb: () => db, auth, need, wrap });
require('./reservations')(app, { getDb: () => db, auth, need, wrap });
require('./billing')(app, { getDb: () => db, auth, need, wrap });
require('./operations')(app, { getDb: () => db, auth, need, wrap });
require('./public')(app, { getDb: () => db, auth, need, wrap });
require('./approvals')(app, { getDb: () => db, auth, need, wrap });
require('./catalog')(app, { getDb: () => db, auth, need, wrap, validateRate: b => validateRate(b), checkCurrency: (...a) => checkCurrency(...a) });

// ---------- reference data ----------
app.get('/api/sources', auth, wrap(async (req, res) => res.json(await q('select source_id, code, name from booking_sources order by source_id'))));
// ---------- dashboard ----------
app.get('/api/dashboard', auth, need('reports.operational'), wrap(async (req, res) => {
  const t = S.today(), p = prop(req);
  const list = where => q(`select r.reservation_id, r.reservation_ref, g.full_name, tp.name room_type, rm.room_number, r.check_in_date::text check_in, r.check_out_date::text check_out, r.status, r.payment_status
    from reservations r join guests g using(guest_id) join reservation_rooms rr using(reservation_id) join room_types tp on tp.room_type_id=rr.room_type_id
    left join rooms rm on rm.room_id=rr.room_id where r.property_id=$2 and ${where} order by r.reservation_ref`, [t, p]);
  const arrivals = await list("r.status='CONFIRMED' and r.check_in_date=$1::date");
  const departures = await list("r.status='CHECKED_IN' and r.check_out_date<=$1::date");
  const [c] = await q(`select (select count(*) from reservations where status='CHECKED_IN' and property_id=$1)::int in_house,
    (select count(*) from rooms r join room_types t using(room_type_id) join room_categories c using(category_id) where c.property_id=$1 and r.status_id=2)::int occupied,
    (select count(*) from rooms r join room_types t using(room_type_id) join room_categories c using(category_id) where c.property_id=$1)::int total_rooms,
    (select count(*) from rate_rules rr join room_types t using(room_type_id) join room_categories c using(category_id) where c.property_id=$1 and rr.approval_status='PENDING')::int pending_rates`, [p]);
  res.json({ today: t, arrivals, departures, ...c, pending_rates: P.can(req.user, 'rates.view_all') ? c.pending_rates : null });
}));

// ---------- rooms ----------
const roomScope = `from rooms r join room_types t using(room_type_id) join room_categories c on c.category_id=t.category_id`;
app.get('/api/rooms', auth, need('catalog.view'), wrap(async (req, res) => res.json(await q(
  `select r.room_id, r.room_number, r.floor, t.room_type_id, t.name room_type, st.code status,
     (select x.reservation_ref from reservation_rooms rr join reservations x using(reservation_id) where rr.room_id=r.room_id and x.status='CHECKED_IN' limit 1) in_house_ref
   ${roomScope} join room_statuses st on st.status_id=r.status_id where c.property_id=$1 order by r.room_number`, [prop(req)]))));
app.patch('/api/rooms/:id/status', auth, need('stay.operate'), wrap(async (req, res) => {
  const b = req.body || {};
  const [st] = await q('select status_id from room_statuses where code=$1', [b.status]);
  if (!st || st.status_id === 2) throw bad('Choose Available, Cleaning or Maintenance/Blocked. Occupied is set by check-in.', [{ field: 'status', message: 'Must be AVAILABLE, CLEANING or MAINTENANCE_BLOCKED.' }]);
  await db.tx(async t => {
    const [cur] = await t.q(`select r.room_id, r.status_id ${roomScope} where r.room_id=$1 and c.property_id=$2`, [req.params.id, prop(req)]);
    if (!cur) throw notFound('Room not found.');
    if (cur.status_id === 2) throw conflict('An occupied room changes status at check-out.', 'INVALID_STATE');
    if (cur.status_id === 4 && b.status !== 'MAINTENANCE_BLOCKED' && (await t.q("select 1 x from maintenance_reports where room_id=$1 and status='OPEN' and blocks_room", [cur.room_id])).length)
      throw conflict('This room is blocked by an open maintenance report. Resolve the report to release it.', 'INVALID_STATE');
    await S.moveRoom(t.q, req.params.id, b.status, req.user.user_id, 'manual');
  });
  res.json({ ok: true });
}));

// ---------- rates (FR-15 to FR-17) ----------
const rateScope = `from rate_rules rr join room_types t using(room_type_id) join room_categories c on c.category_id=t.category_id`;
function validateRate(b) {
  const f = new Fields(), types = ['BASE', 'DATE_RANGE', 'SELECTED_DAY', 'SPECIFIC_DATE'];
  const has = k => b[k] !== undefined && b[k] !== null && b[k] !== '' && !(Array.isArray(b[k]) && !b[k].length);
  const unused = (keys, label) => keys.forEach(k => has(k) && f.add(k, `Not used by ${label}.`));
  if (!isUuid(b.room_type_id)) f.add('room_type_id', 'Choose a room type.');
  if (!types.includes(b.rule_type)) f.add('rule_type', `Must be one of ${types.join(', ')}.`);
  const amt = Number(b.rate_amount);
  if (b.rate_amount === undefined || b.rate_amount === null || b.rate_amount === '' || typeof b.rate_amount === 'boolean' || !Number.isFinite(amt)) f.add('rate_amount', 'Rate must be a number.');
  else if (!(amt > 0)) f.add('rate_amount', 'Rate must be greater than 0.');
  else if (amt > 9999999.99) f.add('rate_amount', 'Rate must be 9,999,999.99 or less.');
  else if (Math.round(amt * 100) / 100 !== amt) f.add('rate_amount', 'Rate can have at most 2 decimal places.');
  if (has('currency_code') && !/^[A-Z]{3}$/.test(String(b.currency_code))) f.add('currency_code', 'Currency must be a 3-letter code such as MYR.');
  if (has('priority') && !(Number.isInteger(Number(b.priority)) && Number(b.priority) >= 0 && Number(b.priority) <= 100)) f.add('priority', 'Priority must be a whole number from 0 to 100.');
  if (b.rule_type === 'BASE') unused(['date_from', 'date_to', 'specific_date', 'selected_days'], 'a Base Rate');
  if (b.rule_type === 'DATE_RANGE') {
    if (!S.isDate(b.date_from)) f.add('date_from', 'Required (YYYY-MM-DD).');
    if (!S.isDate(b.date_to)) f.add('date_to', 'Required (YYYY-MM-DD).');
    else if (S.isDate(b.date_from) && b.date_to < b.date_from) f.add('date_to', 'Must be on or after date_from.');
    else if (S.isDate(b.date_from) && S.nightsList(b.date_from, S.addDays(b.date_to, 1)).length > 366) f.add('date_to', 'A Date Range can cover at most 366 days.');
    unused(['specific_date', 'selected_days'], 'a Date Range');
  }
  if (b.rule_type === 'SELECTED_DAY') {
    if (!Array.isArray(b.selected_days) || !b.selected_days.length || !b.selected_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) f.add('selected_days', 'Choose one or more days (0 = Sunday to 6 = Saturday).');
    else if (new Set(b.selected_days).size !== b.selected_days.length) f.add('selected_days', 'Each day can be chosen once.');
    unused(['date_from', 'date_to', 'specific_date'], 'a Selected Day rule');
  }
  if (b.rule_type === 'SPECIFIC_DATE') {
    if (!S.isDate(b.specific_date)) f.add('specific_date', 'Required (YYYY-MM-DD).');
    unused(['date_from', 'date_to', 'selected_days'], 'a Specific Date rule');
  }
  return f;
}
const rateCols = `rr.rate_rule_id, rr.room_type_id, t.name room_type, rr.rule_type, rr.rate_amount::float8 rate_amount, c.currency_code, rr.date_from::text date_from, rr.date_to::text date_to,
     rr.selected_days, rr.specific_date::text specific_date, rr.priority, rr.approval_status, rr.supersedes_id, rr.effective_from::text effective_from, rr.valid_until::text valid_until,
     (rr.approval_status='APPROVED' and (rr.effective_from is null or rr.effective_from<=$2::date) and (rr.valid_until is null or rr.valid_until>$2::date)) in_force`;
const rateFrom = `from rate_rules rr join room_types t using(room_type_id) join (select c.category_id, c.property_id, p.currency_code from room_categories c join properties p using(property_id)) c on c.category_id=t.category_id`;
app.get('/api/rates', auth, need('rates.view_approved'), wrap(async (req, res) => res.json(await q(
  `select ${rateCols} ${rateFrom} where c.property_id=$1 ${P.can(req.user, 'rates.view_all') ? '' : "and rr.approval_status='APPROVED'"} order by t.name, rr.rule_type, rr.created_at`, [prop(req), S.today()]))));
const hasV = (b, k) => b[k] !== undefined && b[k] !== null && b[k] !== '';
const sortedDays = d => Array.isArray(d) && d.length ? [...d].sort((x, y) => x - y) : null;
// S063: the rate is in the property's currency. A different currency in the request is refused.
async function checkCurrency(run, propertyId, b) {
  const [p] = await run('select currency_code from properties where property_id=$1', [propertyId]);
  if (hasV(b, 'currency_code') && b.currency_code !== p.currency_code) throw bad('This property sells in ' + p.currency_code + '.', [{ field: 'currency_code', message: `Must be ${p.currency_code} (the property currency).` }]);
  return p.currency_code;
}
// S066: warn when a new rule ties with an approved rule (same type and priority and an overlapping night), because the SRS leaves precedence open.
async function tieWarnings(run, typeId, b) {
  const rules = (await S.loadRules(run, typeId)).filter(r => r.approval_status === 'APPROVED' && r.valid_until == null && r.rule_type === b.rule_type && (r.priority ?? 0) === (hasV(b, 'priority') ? Number(b.priority) : 0));
  const overlaps = r => {
    if (b.rule_type === 'BASE') return true;
    if (b.rule_type === 'SPECIFIC_DATE') return r.specific_date === b.specific_date;
    if (b.rule_type === 'SELECTED_DAY') return (r.selected_days || []).some(d => (b.selected_days || []).includes(d));
    return r.date_from <= b.date_to && b.date_from <= r.date_to;
  };
  return rules.filter(overlaps).map(r => ({ code: 'PRIORITY_TIE', message: 'An approved rule of the same type and priority already covers some of these nights. Give one a higher priority.', rate_rule_id: r.rate_rule_id }));
}
const rateRow = async (run, id, propertyId) => (await run(`select rr.*, c.property_id ${rateScope} where rr.rate_rule_id=$1 and c.property_id=$2`, [id, propertyId]))[0];

app.post('/api/rates', auth, need('rates.manage'), wrap(async (req, res) => {
  const b = req.body || {}; validateRate(b).check();
  const [t] = await q('select t.room_type_id from room_types t join room_categories c using(category_id) where t.room_type_id=$1 and c.property_id=$2', [b.room_type_id, prop(req)]);
  if (!t) throw notFound('Room type not found.');
  await checkCurrency(q, prop(req), b);
  const [r] = await q(`insert into rate_rules(room_type_id,rule_type,rate_amount,date_from,date_to,selected_days,specific_date,priority)
    values($1,$2,$3,$4,$5,$6,$7,$8) returning rate_rule_id`, [b.room_type_id, b.rule_type, b.rate_amount, hasV(b, 'date_from') ? b.date_from : null, hasV(b, 'date_to') ? b.date_to : null,
    sortedDays(b.selected_days), hasV(b, 'specific_date') ? b.specific_date : null, hasV(b, 'priority') ? b.priority : null]);
  await S.audit(q, req.user.user_id, 'RATE_CREATED', 'rate_rules', r.rate_rule_id, null, { ...b, approval_status: 'PENDING' });
  res.status(201).json({ rate_rule_id: r.rate_rule_id, approval_status: 'PENDING', warnings: await tieWarnings(q, b.room_type_id, b) });
}));

// S068: change an approved rate. The change is a new PENDING rate; the approved rate stays in force until the change is approved and its date arrives.
app.post('/api/rates/:id/revise', auth, need('rates.manage'), wrap(async (req, res) => {
  const b = req.body || {}, f = new Fields();
  const cur = await rateRow(q, req.params.id, prop(req));
  if (!cur) throw notFound('Rate not found.');
  if (cur.approval_status !== 'APPROVED' || cur.valid_until) throw conflict('Only a rate that is approved and in force can be changed. Edit a pending rate by withdrawing it and creating it again.', 'INVALID_STATE');
  const amt = Number(b.rate_amount);
  if (b.rate_amount === undefined || b.rate_amount === null || b.rate_amount === '' || !Number.isFinite(amt)) f.add('rate_amount', 'Rate must be a number.');
  else if (!(amt > 0) || amt > 9999999.99 || Math.round(amt * 100) / 100 !== amt) f.add('rate_amount', 'Rate must be more than 0, at most 9,999,999.99, with at most 2 decimal places.');
  if (hasV(b, 'effective_from')) { if (!S.isDate(b.effective_from)) f.add('effective_from', 'Must be a date (YYYY-MM-DD).'); else if (b.effective_from < S.today()) f.add('effective_from', 'Must be today or later.'); }
  if (hasV(b, 'priority') && !(Number.isInteger(Number(b.priority)) && Number(b.priority) >= 0 && Number(b.priority) <= 100)) f.add('priority', 'Priority must be a whole number from 0 to 100.');
  f.check();
  await checkCurrency(q, prop(req), b);
  if (amt === Number(cur.rate_amount) && !hasV(b, 'priority')) throw bad('The new rate is the same as the current one.', [{ field: 'rate_amount', message: 'Enter a different rate.' }]);
  const [dup] = await q("select 1 x from rate_rules where supersedes_id=$1 and approval_status='PENDING'", [cur.rate_rule_id]);
  if (dup) throw conflict('A change to this rate is already waiting for approval. Withdraw it first.', 'INVALID_STATE');
  const [r] = await q(`insert into rate_rules(room_type_id,rule_type,rate_amount,date_from,date_to,selected_days,specific_date,priority,supersedes_id,effective_from)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning rate_rule_id`, [cur.room_type_id, cur.rule_type, b.rate_amount, cur.date_from, cur.date_to, cur.selected_days, cur.specific_date,
    hasV(b, 'priority') ? b.priority : cur.priority, cur.rate_rule_id, hasV(b, 'effective_from') ? b.effective_from : null]);
  await S.audit(q, req.user.user_id, 'RATE_CHANGE_SUBMITTED', 'rate_rules', r.rate_rule_id, { rate_amount: Number(cur.rate_amount) }, { rate_amount: amt, effective_from: b.effective_from || null, supersedes_id: cur.rate_rule_id });
  res.status(201).json({ rate_rule_id: r.rate_rule_id, approval_status: 'PENDING', supersedes_id: cur.rate_rule_id, current_rate: Number(cur.rate_amount), effective_from: hasV(b, 'effective_from') ? b.effective_from : null });
}));

app.post('/api/rates/:id/approve', auth, need('rates.approve'), wrap(async (req, res) => {
  await db.tx(t => Approvals.logic.approve(t, prop(req), req.user.user_id, 'RATE', req.params.id));
  res.json({ ok: true });
}));

// Withdraw a rate that is still PENDING (a new rule or a change). Approved rates are never deleted.
app.delete('/api/rates/:id', auth, need('rates.manage'), wrap(async (req, res) => {
  const r = await rateRow(q, req.params.id, prop(req));
  if (!r) throw notFound('Rate not found.');
  if (r.approval_status !== 'PENDING') throw conflict('Only a pending rate can be withdrawn. An approved rate is replaced with "change rate".', 'INVALID_STATE');
  await q('delete from rate_rules where rate_rule_id=$1', [r.rate_rule_id]);
  await S.audit(q, req.user.user_id, 'RATE_WITHDRAWN', 'rate_rules', r.rate_rule_id, { rate_amount: Number(r.rate_amount), rule_type: r.rule_type }, null);
  res.json({ ok: true });
}));

// S066: nightly price preview. Shows the winning rule for each night, the other rules that matched, and nights that tie.
app.get('/api/rates/preview', auth, need('rates.view_approved'), wrap(async (req, res) => {
  const { room_type_id, from, to } = req.query, f = new Fields(), canAll = P.can(req.user, 'rates.view_all');
  if (!isUuid(room_type_id)) f.add('room_type_id', 'Choose a room type.');
  if (!S.isDate(from)) f.add('from', 'Must be a date (YYYY-MM-DD).');
  if (!S.isDate(to)) f.add('to', 'Must be a date (YYYY-MM-DD).');
  else if (S.isDate(from) && to <= from) f.add('to', 'Must be after from (check-out night is not counted).');
  else if (S.isDate(from) && S.nightsList(from, to).length > 90) f.add('to', 'Preview at most 90 nights.');
  f.check();
  const [t] = await q(`select t.room_type_id, t.name, t.approval_status from room_types t join room_categories c using(category_id) where t.room_type_id=$1 and c.property_id=$2`, [room_type_id, prop(req)]);
  if (!t || (t.approval_status !== 'APPROVED' && !canAll)) throw notFound('Room type not found.');
  const rules = await S.loadRules(q, room_type_id), nights = S.nightsList(from, to).map(d => S.explainNight(rules, d));
  const priced = nights.every(n => n.rate !== null);
  res.json({ room_type_id, room_type: t.name, nights: canAll ? nights : nights.map(n => ({ date: n.date, rate: n.rate, rule: n.rule })),
    total: priced ? Math.round(nights.reduce((s, n) => s + n.rate, 0) * 100) / 100 : null, missing_rate_nights: nights.filter(n => n.rate === null).map(n => n.date),
    ties: canAll ? nights.filter(n => n.tie).map(n => n.date) : undefined });
}));

// ---------- audit (FR-22) ----------
app.get('/api/audit', auth, need('audit.view'), wrap(async (req, res) => res.json(await q(
  `select a.audit_id::int audit_id, a.created_at, u.full_name, a.action, a.entity_type, a.new_values
   from audit_records a join users u using(user_id) where u.property_id=$1 order by a.audit_id desc limit 100`, [prop(req)]))));


// ---------- my sessions (S056) ----------
app.get('/api/sessions', auth, wrap(async (req, res) => {
  const rows = await q(`select session_id, created_at, last_seen_at, expires_at, user_agent from user_sessions
    where user_id=$1 and revoked_at is null and expires_at > now() order by created_at desc`, [req.user.user_id]);
  res.json(rows.map(r => ({ ...r, current: r.session_id === req.session_id })));
}));
app.delete('/api/sessions/:id', auth, wrap(async (req, res) => {
  const n = await A.revokeSessions(q, req.user.user_id, 'REVOKED_BY_USER', null, req.params.id);
  if (!n) throw notFound('Session not found.');
  await S.audit(q, req.user.user_id, 'SESSION_REVOKED', 'user_sessions', req.params.id, null, { reason: 'REVOKED_BY_USER' });
  res.json({ ok: true });
}));
app.post('/api/sessions/revoke-others', auth, wrap(async (req, res) => {
  const n = await A.revokeSessions(q, req.user.user_id, 'REVOKED_BY_USER', req.session_id);
  if (n) await S.audit(q, req.user.user_id, 'SESSIONS_REVOKED', 'users', req.user.user_id, null, { count: n, reason: 'REVOKED_BY_USER' });
  res.json({ revoked: n });
}));

// ---------- password rules and my password (S058) ----------
app.get('/api/password-policy', (req, res) => res.json({ min_length: POLICY.min_length, max_length: POLICY.max_length, rules: POLICY.rules }));
app.post('/api/me/password', auth, wrap(async (req, res) => {
  const b = req.body || {}, f = new Fields();
  if (typeof b.current_password !== 'string' || !b.current_password) f.add('current_password', 'Current password is required.');
  if (typeof b.new_password !== 'string' || !b.new_password) f.add('new_password', 'New password is required.');
  f.check();
  const [u] = await q('select user_id, email, full_name, password_hash from users where user_id=$1', [req.user.user_id]);
  if (!(await verifyPassword(b.current_password, u.password_hash))) {
    await A.registerFailedAttempt(q, u.user_id);                      // a stolen token must not allow unlimited guessing
    throw bad('Please correct the fields listed.', [{ field: 'current_password', message: 'Current password is incorrect.' }]);
  }
  validatePassword(b.new_password, { email: u.email, full_name: u.full_name }).forEach(m => f.add('new_password', m));
  if (b.new_password === b.current_password) f.add('new_password', 'The new password must be different from the current one.');
  f.check();
  const hash = await hashPassword(b.new_password);
  await db.tx(async t => {
    await t.q('update users set password_hash=$2, password_changed_at=now(), failed_login_count=0, locked_until=null where user_id=$1', [u.user_id, hash]);
    const n = await A.revokeSessions(t.q, u.user_id, 'PASSWORD_CHANGED', req.session_id);
    await S.audit(t.q, u.user_id, 'PASSWORD_CHANGED', 'users', u.user_id, null, { other_sessions_ended: n });
  });
  res.json({ ok: true });
}));

// ---------- staff accounts (S058). "Limited" for a Manager = Front Desk accounts only (assumption in the contract). ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const staffSelect = `select u.user_id, u.full_name, u.email, u.phone, r.name role, u.can_approve_rates, u.is_active, u.last_login_at, u.created_at from users u join roles r using(role_id)`;
const loadStaff = async (run, propertyId, id) => { const [u] = await run(`${staffSelect} where u.user_id=$1 and u.property_id=$2`, [id, propertyId]); if (!u) throw notFound('User not found.'); return u; };
const mustManage = (actor, targetRole) => { if (!P.canManageUser(actor, targetRole)) throw forbidden(targetRole === P.FD ? 'Your role cannot manage accounts.' : 'Only an Administrator can manage Administrator and Manager accounts.'); };
const nameProblem = v => typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 120;
const phoneProblem = v => v != null && (typeof v !== 'string' || v.trim().length > 30);   // optional, up to 30 characters

app.get('/api/roles', auth, need('users.view'), wrap(async (req, res) => res.json(await q('select name from roles order by role_id'))));
app.get('/api/users', auth, need('users.view'), wrap(async (req, res) => res.json(await q(`${staffSelect} where u.property_id=$1 order by u.full_name`, [prop(req)]))));

app.post('/api/users', auth, need('users.manage_frontdesk'), wrap(async (req, res) => {
  const b = req.body || {}, f = new Fields();
  if (!P.ROLES.includes(b.role)) f.add('role', `Must be one of ${P.ROLES.join(', ')}.`);
  else mustManage(req.user, b.role);                                                       // 403 before anything else is checked
  if (nameProblem(b.full_name)) f.add('full_name', 'Full name must be 2 to 120 characters.');
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 160) f.add('email', 'Enter a valid email address (up to 160 characters).');
  if (phoneProblem(b.phone)) f.add('phone', 'Phone number must be 30 characters or fewer.');
  validatePassword(b.password, { email, full_name: b.full_name }).forEach(m => f.add('password', m));
  if (b.can_approve_rates !== undefined && typeof b.can_approve_rates !== 'boolean') f.add('can_approve_rates', 'Must be true or false.');
  else if (b.can_approve_rates === true) {
    if (!P.can(req.user, 'users.manage_any')) throw forbidden('Only an Administrator can give the right to approve rates.');
    if (b.role !== P.MGR) f.add('can_approve_rates', 'Only Owner/Manager accounts can have this right.');
  }
  f.check();
  const [dup] = await q('select 1 x from users where lower(email)=$1', [email]);
  if (dup) throw conflict('That email is already used by another account.', 'CONFLICT', [{ field: 'email', message: 'Already in use.' }]);
  const hash = await hashPassword(b.password);
  const created = await db.tx(async t => {
    const [row] = await t.q(`insert into users(property_id,role_id,full_name,email,password_hash,can_approve_rates,phone)
      values($1,(select role_id from roles where name=$2),$3,$4,$5,$6,$7) returning user_id`, [prop(req), b.role, b.full_name.trim(), email, hash, b.can_approve_rates === true, b.phone ? b.phone.trim() : null]);
    await S.audit(t.q, req.user.user_id, 'USER_CREATED', 'users', row.user_id, null, { email, role: b.role, can_approve_rates: b.can_approve_rates === true });
    return row;
  });
  res.status(201).json(await loadStaff(q, prop(req), created.user_id));
}));

app.patch('/api/users/:id', auth, need('users.manage_frontdesk'), wrap(async (req, res) => {
  const b = req.body || {}, target = await loadStaff(q, prop(req), req.params.id);
  mustManage(req.user, target.role);
  const f = new Fields(), ch = {};
  if ('full_name' in b) { if (nameProblem(b.full_name)) f.add('full_name', 'Full name must be 2 to 120 characters.'); else ch.full_name = b.full_name.trim(); }
  if ('phone' in b) { if (phoneProblem(b.phone)) f.add('phone', 'Phone number must be 30 characters or fewer.'); else if ((b.phone ? b.phone.trim() : null) !== (target.phone || null)) ch.phone = b.phone ? b.phone.trim() : ''; }
  if ('is_active' in b) { if (typeof b.is_active !== 'boolean') f.add('is_active', 'Must be true or false.'); else if (b.is_active !== target.is_active) ch.is_active = b.is_active; }
  if ('role' in b) { if (!P.ROLES.includes(b.role)) f.add('role', `Must be one of ${P.ROLES.join(', ')}.`); else if (b.role !== target.role) ch.role = b.role; }
  if ('can_approve_rates' in b) { if (typeof b.can_approve_rates !== 'boolean') f.add('can_approve_rates', 'Must be true or false.'); else if (b.can_approve_rates !== target.can_approve_rates) ch.can_approve_rates = b.can_approve_rates; }
  f.check();
  if (('role' in ch || 'can_approve_rates' in ch) && !P.can(req.user, 'users.manage_any')) throw forbidden('Only an Administrator can change roles or the right to approve rates.');
  const finalRole = ch.role || target.role;
  if (ch.can_approve_rates === true && finalRole !== P.MGR) throw bad('Please correct the fields listed.', [{ field: 'can_approve_rates', message: 'Only Owner/Manager accounts can have this right.' }]);
  if (ch.role && target.can_approve_rates && finalRole !== P.MGR) ch.can_approve_rates = false;      // leaving the Manager role removes the right
  if (target.user_id === req.user.user_id && (ch.is_active === false || ch.role)) throw conflict('You cannot deactivate your own account or change your own role.', 'INVALID_STATE');
  if (target.role === P.ADMIN && (ch.is_active === false || (ch.role && ch.role !== P.ADMIN))) {
    const [o] = await q(`select count(*)::int n from users u join roles r using(role_id) where u.property_id=$1 and r.name='ADMINISTRATOR' and u.is_active and u.user_id<>$2`, [prop(req), target.user_id]);
    if (!o.n) throw conflict('At least one active Administrator must remain.', 'INVALID_STATE');
  }
  if (!Object.keys(ch).length) return res.json(target);
  await db.tx(async t => {
    await t.q(`update users set full_name=coalesce($2,full_name), is_active=coalesce($3,is_active), can_approve_rates=coalesce($4,can_approve_rates),
      role_id=coalesce((select role_id from roles where name=$5),role_id), phone=case when $6::text is null then phone else nullif($6::text,'') end where user_id=$1`, [target.user_id, ch.full_name ?? null, ch.is_active ?? null, ch.can_approve_rates ?? null, ch.role ?? null, ch.phone ?? null]);
    if (ch.is_active === false || ch.role) await A.revokeSessions(t.q, target.user_id, 'ACCOUNT_CHANGED');   // the next call from that user is refused
    const before = {}; Object.keys(ch).forEach(k => before[k] = target[k]);
    await S.audit(t.q, req.user.user_id, 'USER_UPDATED', 'users', target.user_id, before, ch);
  });
  res.json(await loadStaff(q, prop(req), target.user_id));
}));

app.post('/api/users/:id/reset-password', auth, need('users.manage_frontdesk'), wrap(async (req, res) => {
  const target = await loadStaff(q, prop(req), req.params.id); mustManage(req.user, target.role);
  const f = new Fields(), pw = (req.body || {}).new_password;
  validatePassword(pw, { email: target.email, full_name: target.full_name }).forEach(m => f.add('new_password', m));
  f.check();
  const hash = await hashPassword(pw);
  await db.tx(async t => {
    await t.q('update users set password_hash=$2, password_changed_at=now(), failed_login_count=0, locked_until=null where user_id=$1', [target.user_id, hash]);
    const n = await A.revokeSessions(t.q, target.user_id, 'PASSWORD_RESET', target.user_id === req.user.user_id ? req.session_id : null);
    await S.audit(t.q, req.user.user_id, 'PASSWORD_RESET', 'users', target.user_id, null, { sessions_ended: n });
  });
  res.json({ ok: true });
}));

app.post('/api/users/:id/revoke-sessions', auth, need('users.manage_frontdesk'), wrap(async (req, res) => {
  const target = await loadStaff(q, prop(req), req.params.id); mustManage(req.user, target.role);
  const n = await A.revokeSessions(q, target.user_id, 'REVOKED_BY_ADMIN', target.user_id === req.user.user_id ? req.session_id : null);
  await S.audit(q, req.user.user_id, 'SESSIONS_REVOKED', 'users', target.user_id, null, { count: n, reason: 'REVOKED_BY_ADMIN' });
  res.json({ revoked: n });
}));

// ---------- errors: one shape for everything (S055) ----------
// Demo pages (manager approvals, guest booking). Not served in production.
if (process.env.NODE_ENV !== 'production') app.use('/demo', express.static(require('path').join(__dirname, 'demo-ui')));
app.use((req, res, next) => next(notFound('No such endpoint.')));
app.use((err, req, res, next) => {
  let status = 500, code = 'INTERNAL_ERROR', message = 'Something went wrong on the server.', fields;
  if (err instanceof HttpError) ({ status, code, message, fields } = err);
  else if (err.type === 'entity.parse.failed') { status = 400; code = 'VALIDATION_ERROR'; message = 'The request body is not valid JSON.'; }
  else if (err.type === 'entity.too.large') { status = 400; code = 'VALIDATION_ERROR'; message = 'The request body is too large.'; }
  else if (err.code === '23505') { status = 409; code = 'CONFLICT'; message = 'That value already exists.'; }
  else if (['22P02', '22007', '22008', '22003'].includes(err.code)) { status = 400; code = 'VALIDATION_ERROR'; message = 'A value has the wrong format.'; }
  else console.error(`[${req.id}]`, err);
  res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}), request_id: req.id } });
});

async function start(port = process.env.PORT || 3000) {
  db = await require('./db').ensureSchema();
  // S180: holds that ran out of time give their rooms back by themselves, not only when somebody searches. One statement, safe to run from many servers.
  const every = Math.max(Number(process.env.HOLD_SWEEP_SECONDS) || 30, 1) * 1000;
  const timer = setInterval(() => S.sweepHolds(db.q).catch(e => console.error('hold sweep failed:', e.message)), every); timer.unref();
  return new Promise(resolve => { const s = app.listen(port, () => resolve(s)); s0 = s; });
}
module.exports = { start, app };
if (require.main === module) start().then(s => console.log(`FDS backend running at http://localhost:${s.address().port}  [${db.mode}]`));
