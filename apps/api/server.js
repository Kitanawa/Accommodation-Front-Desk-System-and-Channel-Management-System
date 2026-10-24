// FDS backend. Follows the API contract in docs/API_CONTRACT.md (S055):
// UUID identifiers, one error shape with codes, X-Request-Id on every response, property-scoped data.
const express = require('express');
const crypto = require('crypto');
const S = require('./service');
const A = require('./auth');
const P = require('./permissions');
const { HttpError, bad, forbidden, notFound, conflict, Fields, isUuid } = require('./errors');
const { hashPassword, verifyPassword, validatePassword, POLICY } = require('./password');

let db;
const app = express();
app.use((req, res, next) => {                       // request id + CORS (a separate front end may call this API)
  req.id = crypto.randomUUID();
  res.set({ 'X-Request-Id': req.id, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'X-Request-Id' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '100kb' }));
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

// ---------- reference data ----------
app.get('/api/sources', auth, wrap(async (req, res) => res.json(await q('select source_id, code, name from booking_sources order by source_id'))));
app.get('/api/room-types', auth, need('catalog.view'), wrap(async (req, res) => res.json(await q(
  `select t.room_type_id, t.name, c.name category, t.max_guests, t.min_nights, t.description, t.facilities, t.layout_info
   from room_types t join room_categories c using(category_id) where c.property_id=$1 order by t.name`, [prop(req)]))));

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

// ---------- availability and reservations ----------
app.get('/api/availability', auth, need('reservations.manage'), wrap(async (req, res) => res.json(await S.availability(q, prop(req), req.query))));

app.post('/api/reservations', auth, need('reservations.manage'), wrap(async (req, res) => {
  const r = await db.tx(t => S.createReservation(t, prop(req), req.body || {}, req.user.user_id));
  res.status(201).json(r);
}));
app.get('/api/reservations', auth, need('reservations.manage'), wrap(async (req, res) => {
  const params = [prop(req)], where = ['r.property_id=$1'];
  if (req.query.status) {
    if (!['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'].includes(req.query.status)) throw bad('Invalid status filter.', [{ field: 'status', message: 'Must be CONFIRMED, CHECKED_IN, CHECKED_OUT or CANCELLED.' }]);
    params.push(req.query.status); where.push(`r.status=$${params.length}`);
  }
  if (req.query.q) { params.push('%' + req.query.q + '%'); where.push(`(r.reservation_ref ilike $${params.length} or g.full_name ilike $${params.length})`); }
  res.json(await q(`select r.reservation_id, r.reservation_ref, g.full_name, tp.name room_type, rm.room_number, r.check_in_date::text check_in, r.check_out_date::text check_out,
    r.total_guests, r.status, r.payment_status, s.name source,
    (select coalesce(sum(c.amount),0)::float8 from charges c join folios f using(folio_id) where f.reservation_id=r.reservation_id) total
    from reservations r join guests g using(guest_id) join booking_sources s using(source_id) join reservation_rooms rr using(reservation_id)
    join room_types tp on tp.room_type_id=rr.room_type_id left join rooms rm on rm.room_id=rr.room_id
    where ${where.join(' and ')} order by r.check_in_date desc, r.reservation_ref limit 200`, params));
}));
app.get('/api/reservations/:id', auth, need('reservations.manage'), wrap(async (req, res) => res.json(await S.getReservation(q, prop(req), req.params.id))));

app.patch('/api/reservations/:id', auth, need('reservations.manage'), wrap(async (req, res) => {
  const r = await S.getReservation(q, prop(req), req.params.id);
  if (['CANCELLED', 'CHECKED_OUT'].includes(r.status)) throw conflict(`A ${r.status.toLowerCase().replace('_', ' ')} reservation cannot be edited.`, 'INVALID_STATE');
  const b = req.body || {};
  await db.tx(async t => {
    await t.q('update guests set full_name=coalesce($2,full_name), phone=coalesce($3,phone), email=coalesce($4,email) where guest_id=$1', [r.guest_id, b.full_name || null, b.phone || null, b.email || null]);
    await t.q('update reservations set special_requests=coalesce($2,special_requests), notes=coalesce($3,notes), estimated_arrival=coalesce($4::time,estimated_arrival) where reservation_id=$1', [r.reservation_id, b.special_requests ?? null, b.notes ?? null, b.estimated_arrival || null]);
    await S.audit(t.q, req.user.user_id, 'RESERVATION_UPDATED', 'reservations', r.reservation_id, null, b);
  });
  res.json(await S.getReservation(q, prop(req), req.params.id));
}));

app.post('/api/reservations/:id/cancel', auth, need('reservations.manage'), wrap(async (req, res) => {
  await db.tx(async t => {
    const r = await S.getReservation(t.q, prop(req), req.params.id);
    if (r.status !== 'CONFIRMED') throw conflict('Only a confirmed reservation can be cancelled.', 'INVALID_STATE');
    await t.q("update reservations set status='CANCELLED' where reservation_id=$1", [r.reservation_id]);
    await t.q('update room_stock set reserved_rooms=reserved_rooms-1 where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date and reserved_rooms>0', [r.room_type_id, r.check_in, r.check_out]);
    await S.audit(t.q, req.user.user_id, 'RESERVATION_CANCELLED', 'reservations', r.reservation_id, { status: 'CONFIRMED' }, { status: 'CANCELLED' });
  });
  res.json(await S.getReservation(q, prop(req), req.params.id));
}));

app.get('/api/reservations/:id/free-rooms', auth, need('stay.operate'), wrap(async (req, res) => {
  const r = await S.getReservation(q, prop(req), req.params.id);
  res.json(await S.freeRooms(q, r.room_type_id, r.check_in, r.check_out, r.reservation_id, false));
}));
app.post('/api/reservations/:id/assign-room', auth, need('stay.operate'), wrap(async (req, res) => {
  if (!isUuid((req.body || {}).room_id)) throw bad('Choose a room.', [{ field: 'room_id', message: 'Must be a room id (UUID).' }]);
  await db.tx(async t => {
    const r = await S.getReservation(t.q, prop(req), req.params.id);
    if (!['CONFIRMED', 'CHECKED_IN'].includes(r.status)) throw conflict('Rooms can only be assigned to active reservations.', 'INVALID_STATE');
    const ok = (await S.freeRooms(t.q, r.room_type_id, r.check_in, r.check_out, r.reservation_id, false)).find(x => x.room_id === req.body.room_id);
    if (!ok) throw conflict('That room is not free for these dates, is blocked, or is a different room type.', 'ROOM_NOT_AVAILABLE');
    await t.q('update reservation_rooms set room_id=$2 where reservation_room_id=$1', [r.reservation_room_id, ok.room_id]);
    await S.audit(t.q, req.user.user_id, 'ROOM_ASSIGNED', 'reservations', r.reservation_id, { room: r.room_number || null }, { room: ok.room_number });
  });
  res.json(await S.getReservation(q, prop(req), req.params.id));
}));

app.post('/api/reservations/:id/check-in', auth, need('stay.operate'), wrap(async (req, res) => {
  await db.tx(async t => {
    const r = await S.getReservation(t.q, prop(req), req.params.id);
    if (r.status !== 'CONFIRMED') throw conflict('Only a confirmed reservation can be checked in.', 'INVALID_STATE');
    let roomId = r.room_id, roomNo = r.room_number;
    const [rm] = roomId ? await t.q('select status_id from rooms where room_id=$1', [roomId]) : [];
    if (roomId && rm.status_id !== 1) throw conflict(`Room ${roomNo} is not available right now (cleaning, occupied or blocked). Assign another room.`, 'ROOM_NOT_AVAILABLE');
    if (!roomId) {
      const [free] = await S.freeRooms(t.q, r.room_type_id, r.check_in, r.check_out, r.reservation_id, true);
      if (!free) throw conflict('No available room of this type is ready for check-in.', 'ROOM_NOT_AVAILABLE');
      roomId = free.room_id; roomNo = free.room_number;
      await t.q('update reservation_rooms set room_id=$2 where reservation_room_id=$1', [r.reservation_room_id, roomId]);
    }
    await t.q('update rooms set status_id=2 where room_id=$1', [roomId]);
    await t.q("update reservations set status='CHECKED_IN' where reservation_id=$1", [r.reservation_id]);
    await S.audit(t.q, req.user.user_id, 'CHECKED_IN', 'reservations', r.reservation_id, { status: 'CONFIRMED' }, { status: 'CHECKED_IN', room: roomNo });
  });
  res.json(await S.getReservation(q, prop(req), req.params.id));
}));
app.post('/api/reservations/:id/check-out', auth, need('stay.operate'), wrap(async (req, res) => {
  await db.tx(async t => {
    const r = await S.getReservation(t.q, prop(req), req.params.id);
    if (r.status !== 'CHECKED_IN') throw conflict('Only a checked-in reservation can be checked out.', 'INVALID_STATE');
    if (r.balance > 0.001) throw conflict(`Outstanding balance of ${r.balance.toFixed(2)}. Record payment before check-out.`, 'BALANCE_OUTSTANDING');
    await t.q('update rooms set status_id=3 where room_id=$1', [r.room_id]);
    await t.q("update reservations set status='CHECKED_OUT' where reservation_id=$1", [r.reservation_id]);
    await t.q('update folios set closed_at=now() where folio_id=$1', [r.folio_id]);
    await S.audit(t.q, req.user.user_id, 'CHECKED_OUT', 'reservations', r.reservation_id, { status: 'CHECKED_IN' }, { status: 'CHECKED_OUT' });
  });
  res.json(await S.getReservation(q, prop(req), req.params.id));
}));

// ---------- folio ----------
app.post('/api/reservations/:id/charges', auth, need('folio.manage'), wrap(async (req, res) => {
  const b = req.body || {}, f = new Fields();
  if (typeof b.description !== 'string' || !b.description.trim()) f.add('description', 'Description is required.');
  else if (b.description.length > 200) f.add('description', 'At most 200 characters.');
  const qty = b.quantity === undefined ? 1 : Number(b.quantity);
  if (!(qty > 0)) f.add('quantity', 'Quantity must be greater than 0.');
  if (b.unit_price === undefined || b.unit_price === '' || !(Number(b.unit_price) >= 0)) f.add('unit_price', 'Unit price must be a number of 0 or more.');
  f.check();
  await db.tx(async t => {
    const r = await S.getReservation(t.q, prop(req), req.params.id);
    if (r.closed_at || r.status === 'CANCELLED') throw conflict('This folio is closed.', 'FOLIO_CLOSED');
    const amount = money(qty * Number(b.unit_price));
    const [c] = await t.q(`insert into charges(folio_id,charge_type,description,quantity,unit_price,amount) values($1,'ADDITIONAL',$2,$3,$4,$5) returning charge_id`, [r.folio_id, b.description.trim(), qty, b.unit_price, amount]);
    await S.recalcPayment(t.q, r.reservation_id);
    await S.audit(t.q, req.user.user_id, 'CHARGE_POSTED', 'charges', c.charge_id, null, { description: b.description.trim(), amount });
  });
  res.status(201).json(await S.getReservation(q, prop(req), req.params.id));
}));
app.post('/api/reservations/:id/payments', auth, need('folio.manage'), wrap(async (req, res) => {
  const b = req.body || {}, f = new Fields(), amount = money(b.amount);
  if (!(amount > 0)) f.add('amount', 'Payment amount must be greater than 0.');
  if (!['CASH', 'CARD', 'ONLINE', 'BANK_TRANSFER'].includes(b.method)) f.add('method', 'Must be CASH, CARD, ONLINE or BANK_TRANSFER.');
  f.check();
  await db.tx(async t => {
    const r = await S.getReservation(t.q, prop(req), req.params.id);
    if (r.status === 'CANCELLED') throw conflict('Reservation is cancelled.', 'INVALID_STATE');
    if (amount > r.balance + 0.001) throw bad(`Payment is more than the balance of ${r.balance.toFixed(2)}.`, [{ field: 'amount', message: `At most ${r.balance.toFixed(2)}.` }]);
    const [p] = await t.q('insert into payments(folio_id,amount,currency_code,method) values($1,$2,(select currency_code from folios where folio_id=$1),$3) returning payment_id', [r.folio_id, amount, b.method]);
    const st = await S.recalcPayment(t.q, r.reservation_id);
    await S.audit(t.q, req.user.user_id, 'PAYMENT_RECORDED', 'payments', p.payment_id, null, { amount, method: b.method, payment_status: st });
  });
  res.status(201).json(await S.getReservation(q, prop(req), req.params.id));
}));

// ---------- rooms ----------
const roomScope = `from rooms r join room_types t using(room_type_id) join room_categories c on c.category_id=t.category_id`;
app.get('/api/rooms', auth, need('catalog.view'), wrap(async (req, res) => res.json(await q(
  `select r.room_id, r.room_number, t.name room_type, st.code status,
     (select x.reservation_ref from reservation_rooms rr join reservations x using(reservation_id) where rr.room_id=r.room_id and x.status='CHECKED_IN' limit 1) in_house_ref
   ${roomScope} join room_statuses st on st.status_id=r.status_id where c.property_id=$1 order by r.room_number`, [prop(req)]))));
app.patch('/api/rooms/:id/status', auth, need('stay.operate'), wrap(async (req, res) => {
  const b = req.body || {};
  const [st] = await q('select status_id from room_statuses where code=$1', [b.status]);
  if (!st || st.status_id === 2) throw bad('Choose Available, Cleaning or Maintenance/Blocked. Occupied is set by check-in.', [{ field: 'status', message: 'Must be AVAILABLE, CLEANING or MAINTENANCE_BLOCKED.' }]);
  const [cur] = await q(`select r.status_id ${roomScope} where r.room_id=$1 and c.property_id=$2`, [req.params.id, prop(req)]);
  if (!cur) throw notFound('Room not found.');
  if (cur.status_id === 2) throw conflict('An occupied room changes status at check-out.', 'INVALID_STATE');
  await q('update rooms set status_id=$2 where room_id=$1', [req.params.id, st.status_id]);
  await S.audit(q, req.user.user_id, 'ROOM_STATUS_CHANGED', 'rooms', req.params.id, { status_id: cur.status_id }, { status: b.status });
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
  if (b.rate_amount === undefined || b.rate_amount === '' || !(Number(b.rate_amount) >= 0)) f.add('rate_amount', 'Rate must be a number of 0 or more.');
  if (has('priority') && !Number.isInteger(Number(b.priority))) f.add('priority', 'Priority must be a whole number.');
  if (b.rule_type === 'BASE') unused(['date_from', 'date_to', 'specific_date', 'selected_days'], 'a Base Rate');
  if (b.rule_type === 'DATE_RANGE') {
    if (!S.isDate(b.date_from)) f.add('date_from', 'Required (YYYY-MM-DD).');
    if (!S.isDate(b.date_to)) f.add('date_to', 'Required (YYYY-MM-DD).'); else if (S.isDate(b.date_from) && b.date_to < b.date_from) f.add('date_to', 'Must be on or after date_from.');
    unused(['specific_date', 'selected_days'], 'a Date Range');
  }
  if (b.rule_type === 'SELECTED_DAY') {
    if (!Array.isArray(b.selected_days) || !b.selected_days.length || !b.selected_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) f.add('selected_days', 'Choose one or more days (0 = Sunday to 6 = Saturday).');
    unused(['date_from', 'date_to', 'specific_date'], 'a Selected Day rule');
  }
  if (b.rule_type === 'SPECIFIC_DATE') {
    if (!S.isDate(b.specific_date)) f.add('specific_date', 'Required (YYYY-MM-DD).');
    unused(['date_from', 'date_to', 'selected_days'], 'a Specific Date rule');
  }
  return f;
}
app.get('/api/rates', auth, need('rates.view_approved'), wrap(async (req, res) => res.json(await q(
  `select rr.rate_rule_id, t.name room_type, rr.rule_type, rr.rate_amount::float8 rate_amount, rr.date_from::text date_from, rr.date_to::text date_to,
     rr.selected_days, rr.specific_date::text specific_date, rr.priority, rr.approval_status
   ${rateScope} where c.property_id=$1 ${P.can(req.user, 'rates.view_all') ? '' : "and rr.approval_status='APPROVED'"} order by t.name, rr.rule_type, rr.created_at`, [prop(req)]))));
app.post('/api/rates', auth, need('rates.manage'), wrap(async (req, res) => {
  const b = req.body || {}; validateRate(b).check();
  const [t] = await q('select t.room_type_id from room_types t join room_categories c using(category_id) where t.room_type_id=$1 and c.property_id=$2', [b.room_type_id, prop(req)]);
  if (!t) throw notFound('Room type not found.');
  const has = k => b[k] !== undefined && b[k] !== null && b[k] !== '';
  const [r] = await q(`insert into rate_rules(room_type_id,rule_type,rate_amount,date_from,date_to,selected_days,specific_date,priority)
    values($1,$2,$3,$4,$5,$6,$7,$8) returning rate_rule_id`, [b.room_type_id, b.rule_type, b.rate_amount, has('date_from') ? b.date_from : null, has('date_to') ? b.date_to : null,
    Array.isArray(b.selected_days) && b.selected_days.length ? b.selected_days : null, has('specific_date') ? b.specific_date : null, has('priority') ? b.priority : null]);
  await S.audit(q, req.user.user_id, 'RATE_CREATED', 'rate_rules', r.rate_rule_id, null, { ...b, approval_status: 'PENDING' });
  res.status(201).json({ rate_rule_id: r.rate_rule_id, approval_status: 'PENDING' });
}));
app.post('/api/rates/:id/approve', auth, need('rates.approve'), wrap(async (req, res) => {
  const [r] = await q(`select rr.rate_rule_id, rr.room_type_id, rr.rule_type, rr.approval_status ${rateScope} where rr.rate_rule_id=$1 and c.property_id=$2`, [req.params.id, prop(req)]);
  if (!r) throw notFound('Rate not found.');
  if (r.approval_status === 'APPROVED') throw conflict('Already approved.', 'INVALID_STATE');
  if (r.rule_type === 'BASE') {
    const [ex] = await q("select 1 x from rate_rules where room_type_id=$1 and rule_type='BASE' and approval_status='APPROVED'", [r.room_type_id]);
    if (ex) throw conflict('This room type already has an approved Base Rate. The SRS does not say how a changed rate replaces an approved one (open question 3).', 'BASE_RATE_EXISTS');
  }
  await q("update rate_rules set approval_status='APPROVED' where rate_rule_id=$1", [r.rate_rule_id]);
  await S.audit(q, req.user.user_id, 'RATE_APPROVED', 'rate_rules', r.rate_rule_id, { approval_status: 'PENDING' }, { approval_status: 'APPROVED' });
  res.json({ ok: true });
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
  return new Promise(resolve => { const s = app.listen(port, () => resolve(s)); });
}
module.exports = { start, app };
if (require.main === module) start().then(s => console.log(`FDS backend running at http://localhost:${s.address().port}  [${db.mode}]`));
