const { bad, conflict, notFound, Fields, isUuid } = require('./errors');
const { hashPassword } = require('./password');

// ---- dates (all 'YYYY-MM-DD' strings, UTC math) ----
const iso = d => d.toISOString().slice(0, 10);
const today = () => iso(new Date(Date.now() + 8 * 3600e3)); // Asia/Kuching (UTC+8)
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T00:00:00Z'));
const nightsList = (from, to) => { const o = []; for (let d = from; d < to; d = addDays(d, 1)) o.push(d); return o; };

// ---- audit (FR-22) ----
const audit = (q, userId, action, type, id, oldV, newV) =>
  q('insert into audit_records(user_id,action,entity_type,entity_id,old_values,new_values) values($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [userId || null, action, type, id, oldV ? JSON.stringify(oldV) : null, newV ? JSON.stringify(newV) : null]);

// ---- pricing (FR-15, FR-16, FR-17) ----
// Only APPROVED rules are used. Precedence is "to be confirmed" in the SRS, so the prototype assumes:
// higher priority wins; on a tie, Specific Date > Date Range > Selected Day > Base. Date Range is inclusive.
const SPEC = { SPECIFIC_DATE: 4, DATE_RANGE: 3, SELECTED_DAY: 2, BASE: 1 };
// Does this rule apply to the night d? (S064 Date Range is inclusive of both ends, S065 Selected Day uses 0 = Sunday to 6 = Saturday.)
function matches(r, d) {
  const dow = new Date(d + 'T00:00:00Z').getUTCDay();
  return r.rule_type === 'BASE' ||
    (r.rule_type === 'SPECIFIC_DATE' && r.specific_date === d) ||
    (r.rule_type === 'DATE_RANGE' && d >= r.date_from && d <= r.date_to) ||
    (r.rule_type === 'SELECTED_DAY' && (r.selected_days || []).includes(dow));
}
// S068: an approved rule applies from effective_from and stops at valid_until (the first night of the rule that replaced it).
const inForce = (r, d) => r.approval_status === 'APPROVED' && (!r.effective_from || d >= r.effective_from) && (!r.valid_until || d < r.valid_until);
const order = (a, b) => ((b.priority ?? 0) - (a.priority ?? 0)) || (SPEC[b.rule_type] - SPEC[a.rule_type]);
function pickRule(rules, d) {
  const m = rules.filter(r => inForce(r, d) && matches(r, d)); m.sort(order);
  return m[0] || null;
}
// S066: every approved rule that matches the night, best first, and the ones that tie with the winner (same priority and same type).
function explainNight(rules, d) {
  const m = rules.filter(r => inForce(r, d) && matches(r, d)); m.sort(order);
  const win = m[0] || null;
  const ties = win ? m.slice(1).filter(r => (r.priority ?? 0) === (win.priority ?? 0) && r.rule_type === win.rule_type) : [];
  return { date: d, rate: win ? win.rate_amount : null, rule: win ? win.rule_type : null, rate_rule_id: win ? win.rate_rule_id : null,
    also_matched: m.slice(1).map(r => ({ rate_rule_id: r.rate_rule_id, rule_type: r.rule_type, rate_amount: r.rate_amount, priority: r.priority ?? 0 })), tie: ties.length > 0 };
}
const loadRules = (q, typeId) => q(`select rate_rule_id, rule_type, rate_amount::float8 rate_amount, date_from::text date_from, date_to::text date_to,
  selected_days, specific_date::text specific_date, priority, approval_status, effective_from::text effective_from, valid_until::text valid_until
  from rate_rules where room_type_id=$1`, [typeId]);
function priceStay(rules, from, to) {
  const nights = nightsList(from, to).map(d => { const r = pickRule(rules, d); return { date: d, rate: r ? r.rate_amount : null, rule: r ? r.rule_type : null }; });
  if (nights.some(n => n.rate === null)) return { nights, total: null };
  return { nights, total: Math.round(nights.reduce((s, n) => s + n.rate, 0) * 100) / 100 };
}

function checkDates(from, to, f = new Fields()) {
  if (!isDate(from)) f.add('check_in', 'Check-in must be a date (YYYY-MM-DD).');
  if (!isDate(to)) f.add('check_out', 'Check-out must be a date (YYYY-MM-DD).');
  if (!f.any) {
    if (to <= from) f.add('check_out', 'Check-out must be after check-in.');
    if (from < today()) f.add('check_in', 'Check-in cannot be in the past.');
  }
  return f;
}

// ---- availability (FR-02, FR-03, FR-18). Every query is limited to the caller's property (S057). ----
async function availability(q, propertyId, { from, to, guests, room_type_id }) {
  const f = checkDates(from, to);
  if (guests !== undefined && guests !== '' && !(Number.isInteger(Number(guests)) && Number(guests) >= 1 && Number(guests) <= 20)) f.add('guests', 'Guests must be a whole number from 1 to 20.');
  if (room_type_id !== undefined && room_type_id !== '' && !isUuid(room_type_id)) f.add('room_type_id', 'Must be a room type id (UUID).');
  if (!f.any && nightsList(from, to).length > 90) f.add('check_out', 'Search at most 90 nights.');
  f.check();
  await sweepHolds(q);                                              // S080: expired holds give their rooms back before we count
  const g = Number(guests) || 1, n = nightsList(from, to).length;
  const types = await q(`select t.room_type_id, t.name, t.max_guests, t.min_nights, t.description, t.facilities, t.layout_info, c.name category
                         from room_types t join room_categories c using(category_id) where c.property_id=$1 and t.approval_status='APPROVED' ${room_type_id ? 'and t.room_type_id=$2' : ''} order by t.name`, room_type_id ? [propertyId, room_type_id] : [propertyId]);
  const out = [];
  for (const t of types) {
    const stock = await q(`select stock_date::text d, total_rooms, reserved_rooms from room_stock
      where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date order by stock_date`, [t.room_type_id, from, to]);
    const covered = stock.length === n;
    const left = covered ? Math.min(...stock.map(s => s.total_rooms - s.reserved_rooms)) : 0;
    const price = priceStay(await loadRules(q, t.room_type_id), from, to);
    const reasons = [];
    if (!covered) reasons.push('No stock configured for these dates');
    if (covered && left <= 0) reasons.push('Sold out');
    if (g > t.max_guests) reasons.push(`Max ${t.max_guests} guests`);
    if (n < t.min_nights) reasons.push(`Minimum ${t.min_nights} nights`);
    if (price.total === null) reasons.push('No approved rate');
    out.push({ ...t, nights: n, rooms_total: covered ? Math.max(...stock.map(s => s.total_rooms)) : 0, rooms_left: Math.max(left, 0), total: price.total, nightly: price.nights, bookable: reasons.length === 0, reasons });
  }
  return out;
}

// ---- inventory: every change to room_stock goes through these three functions (FR-18, SRS 12) ----
// Rows are locked in date order before they are read, so two bookings for the last room cannot both succeed.
const lockStock = (q, typeId, from, to) => q(`select stock_date::text d, total_rooms, reserved_rooms from room_stock
  where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date order by stock_date for update`, [typeId, from, to]);
async function reserveStock(q, rt, from, to) {
  const n = nightsList(from, to).length, stock = await lockStock(q, rt.room_type_id, from, to);
  if (stock.length !== n) throw conflict('No stock configured for every night of this stay.', 'NO_STOCK');
  const full = stock.find(s => s.reserved_rooms >= s.total_rooms);
  if (full) throw conflict(`${rt.name} is sold out on ${full.d}.`, 'SOLD_OUT');
  await q('update room_stock set reserved_rooms=reserved_rooms+1 where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [rt.room_type_id, from, to]);
}
// Returns the nights to the pool. Nights before today are never returned: they can no longer be sold. Gives back how many nights were returned.
async function releaseStock(q, typeId, from, to) {
  const start = from < today() ? today() : from;
  if (start >= to) return 0;
  await q('update room_stock set reserved_rooms=reserved_rooms-1 where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date and reserved_rooms>0', [typeId, start, to]);
  return nightsList(start, to).length;
}
// Several stock ranges at once (a change of dates or room type): lock them in one fixed order so two changes cannot wait for each other.
async function lockRanges(q, ranges) {
  const byType = new Map();
  for (const r of ranges) { const c = byType.get(r.typeId); byType.set(r.typeId, c ? { from: r.from < c.from ? r.from : c.from, to: r.to > c.to ? r.to : c.to } : { from: r.from, to: r.to }); }
  for (const [typeId, r] of [...byType].sort((x, y) => (x[0] < y[0] ? -1 : 1))) await lockStock(q, typeId, r.from, r.to);
}
// S080: holds that ran out of time give their room back. One statement, so two callers at the same moment cannot return it twice.
const sweepHolds = async q => { await sweepHoldsOnly(q); await q(`update booking_attempts set status='EXPIRED', updated_at=now() where status in ('HOLDING','PAYMENT_PENDING') and hold_id in (select hold_id from reservation_holds where status in ('EXPIRED','RELEASED'))`);
  await q(`update payment_sessions set status='EXPIRED' where status='PENDING' and attempt_id in (select attempt_id from booking_attempts where status in ('EXPIRED','ABANDONED','FAILED'))`); };
const sweepHoldsOnly = q => q(`with ex as (update reservation_holds set status='EXPIRED' where status='ACTIVE' and expires_at<now() returning room_type_id, check_in_date, check_out_date),
  n as (select ex.room_type_id, d::date stock_date, count(*)::int c from ex, generate_series(ex.check_in_date, ex.check_out_date - 1, interval '1 day') d group by 1, 2)
  update room_stock s set reserved_rooms = greatest(s.reserved_rooms - n.c, 0) from n where s.room_type_id=n.room_type_id and s.stock_date=n.stock_date`);

// ---- folio totals (S097, S099, S100, S101): the one place that decides what a guest owes ----
const money = n => Math.round(Number(n) * 100) / 100;
// subtotal = charges not voided; discounts come off first; tax is worked out on what is left, at the rate recorded on the folio;
// balance = total - payments received + refunds paid out. Refund requests that are not approved yet change nothing.
async function folioTotals(q, folioId) {
  const [x] = await q(`select (select coalesce(sum(amount),0)::float8 from charges where folio_id=$1 and voided_at is null) subtotal,
    (select coalesce(sum(amount),0)::float8 from folio_discounts where folio_id=$1 and voided_at is null) discounts,
    (select coalesce(sum(amount),0)::float8 from payments where folio_id=$1 and status='COMPLETED') paid,
    (select coalesce(sum(amount),0)::float8 from refunds where folio_id=$1 and status='COMPLETED') refunded,
    (select tax_rate_pct::float8 from folios where folio_id=$1) rate`, [folioId]);
  const subtotal = money(x.subtotal), discount_total = Math.min(money(x.discounts), subtotal), taxable = money(subtotal - discount_total);
  const tax_total = money(taxable * x.rate / 100), total = money(taxable + tax_total);
  const net_paid = money(x.paid - x.refunded);
  return { subtotal, discount_total, taxable, tax_rate_pct: x.rate, tax_total, total, total_paid: money(x.paid), total_refunded: money(x.refunded), net_paid, balance: money(total - net_paid) };
}
async function folioParts(q, folioId) {
  const all = await q(`select charge_id, charge_type, description, quantity::float8 quantity, unit_price::float8 unit_price, amount::float8 amount, charged_at, stay_date::text stay_date, voided_at, void_reason
    from charges where folio_id=$1 order by charged_at, description`, [folioId]);
  const t = await folioTotals(q, folioId);
  return {
    charges: all.filter(c => !c.voided_at), voided_charges: all.filter(c => c.voided_at),
    discounts: await q(`select discount_id, kind, value::float8 value, amount::float8 amount, reason, created_at from folio_discounts where folio_id=$1 and voided_at is null order by created_at`, [folioId]),
    payments: await q('select payment_id, amount::float8 amount, method, status, kind, paid_at, receipt_no from payments where folio_id=$1 order by paid_at, receipt_no', [folioId]),
    refunds: await q('select refund_id, payment_id, amount::float8 amount, status, reason, requested_at, decided_at, refund_no from refunds where folio_id=$1 order by requested_at', [folioId]),
    subtotal: t.subtotal, discount_total: t.discount_total, tax_rate_pct: t.tax_rate_pct, tax_total: t.tax_total,
    total_charges: t.total, total_paid: t.total_paid, total_refunded: t.total_refunded, balance: t.balance,
  };
}

// ---- property policies (S105): one row per property, created the first time it is needed ----
async function settings(q, propertyId) {
  await q('insert into property_settings(property_id) values($1) on conflict do nothing', [propertyId]);
  const [c] = await q(`select property_id, tax_name, tax_rate_pct::float8 tax_rate_pct, to_char(check_in_time,'HH24:MI') check_in_time, to_char(check_out_time,'HH24:MI') check_out_time,
    cancellation_policy, hold_minutes, post_stay_room_status, online_deposit_pct::float8 online_deposit_pct, free_cancellation_hours, late_cancel_fee_pct::float8 late_cancel_fee_pct, updated_at,
    contact_email, contact_phone, logo_data_url from property_settings where property_id=$1`, [propertyId]);
  const [p] = await q('select name property_name, address from properties where property_id=$1', [propertyId]);
  return { ...c, ...p };
}

// ---- room status changes (FR-11, S103, S104): one table of allowed moves ----
const ROOM_MOVES = { AVAILABLE: ['OCCUPIED', 'CLEANING', 'MAINTENANCE_BLOCKED'], OCCUPIED: ['CLEANING'], CLEANING: ['AVAILABLE', 'MAINTENANCE_BLOCKED'], MAINTENANCE_BLOCKED: ['CLEANING', 'AVAILABLE'] };
const STATUS_ID = { AVAILABLE: 1, OCCUPIED: 2, CLEANING: 3, MAINTENANCE_BLOCKED: 4 };
async function moveRoom(q, roomId, to, userId, why) {
  const [r] = await q('select r.room_id, r.room_number, st.code from rooms r join room_statuses st using(status_id) where r.room_id=$1 for update of r', [roomId]);
  if (!r) throw notFound('Room not found.');
  if (r.code === to) return r;
  if (!(ROOM_MOVES[r.code] || []).includes(to)) throw conflict(`Room ${r.room_number} cannot go from ${r.code} to ${to}.`, 'INVALID_STATE');
  await q('update rooms set status_id=$2 where room_id=$1', [roomId, STATUS_ID[to]]);
  await audit(q, userId, 'ROOM_STATUS_CHANGED', 'rooms', roomId, { status: r.code }, { status: to, why });
  return { ...r, code: to };
}

// ---- notifications (S105): who is told about an event, and a log of what was sent ----
const EVENTS = {
  REFUND_REQUESTED:   { roles: ['ADMINISTRATOR', 'OWNER_MANAGER'], text: 'A refund needs approval' },
  REFUND_DECIDED:     { roles: [], text: 'Your refund request was decided' },
  MAINTENANCE_REPORTED: { roles: ['ADMINISTRATOR', 'OWNER_MANAGER'], text: 'A maintenance problem was reported' },
  BOOKING_PAYMENT_PROBLEM: { roles: ['ADMINISTRATOR', 'OWNER_MANAGER'], text: 'An online payment needs attention' },
  ROOM_READY:         { roles: ['ADMINISTRATOR', 'OWNER_MANAGER', 'FRONT_DESK'], text: 'A room is ready' },
};
// In-app messages are stored as DELIVERED. E-mail is only QUEUED: no mail service is connected yet (SRS 13 names none).
// Default: in-app on, e-mail off, unless the person chose otherwise.
async function notify(q, propertyId, event, subject, payload, extraUserIds = []) {
  const e = EVENTS[event];
  const users = await q(`select u.user_id from users u join roles r using(role_id) where u.property_id=$1 and u.is_active
    and (r.name = any($2::text[]) or u.user_id = any($3::uuid[]))`, [propertyId, e.roles, extraUserIds]);
  for (const u of users) {
    const pref = await q('select channel, enabled from notification_preferences where user_id=$1 and event_code=$2', [u.user_id, event]);
    for (const channel of ['IN_APP', 'EMAIL']) {
      const p = pref.find(x => x.channel === channel);
      if (!(p ? p.enabled : channel === 'IN_APP')) continue;
      await q(`insert into notification_logs(property_id,event_code,channel,recipient_user_id,subject,payload,status,delivered_at)
        values($1,$2,$3,$4,$5,$6::jsonb,$7::varchar,case when $7::varchar='DELIVERED' then now() end)`, [propertyId, event, channel, u.user_id, subject, JSON.stringify(payload || {}), channel === 'IN_APP' ? 'DELIVERED' : 'QUEUED']);
    }
  }
}

// ---- reservations ----
// opts.hold: a hold row (already locked and checked by the caller) that keeps the rooms; then no new stock is taken.
async function createReservation(t, propertyId, p, userId, opts = {}) {
  const q = t.q, f = new Fields();
  checkDates(p.check_in, p.check_out, f);
  const guests = Number(p.total_guests);
  if (!Number.isInteger(guests) || guests < 1) f.add('total_guests', 'Number of guests must be 1 or more.');
  if (!isUuid(p.room_type_id)) f.add('room_type_id', 'Choose a room type.');
  if (!p.guest_id && !(p.guest && String(p.guest.full_name || '').trim())) f.add('guest.full_name', 'Guest full name is required.');
  if (p.guest_id && !isUuid(p.guest_id)) f.add('guest_id', 'Invalid guest id.');
  if (p.source_id !== undefined && !(Number.isInteger(p.source_id) && p.source_id >= 1 && p.source_id <= 6)) f.add('source_id', 'Booking source must be 1 to 6 (1 Walk-in, 2 Phone, 3 Email, 4 Website, 5 Travel agent, 6 OTA).');
  f.check();

  const [rt] = await q(`select t.room_type_id, t.name, t.max_guests, t.min_nights, t.approval_status from room_types t join room_categories c using(category_id)
                        where t.room_type_id=$1 and c.property_id=$2`, [p.room_type_id, propertyId]);
  if (!rt) throw notFound('Room type not found.');
  if (rt.approval_status !== 'APPROVED') throw conflict('This room type is waiting for approval and cannot be sold yet.', 'INVALID_STATE');
  const n = nightsList(p.check_in, p.check_out).length;
  if (guests > rt.max_guests) throw bad(`${rt.name} allows at most ${rt.max_guests} guests.`, [{ field: 'total_guests', message: `At most ${rt.max_guests} guests.` }]);
  if (n < rt.min_nights) throw bad(`${rt.name} requires at least ${rt.min_nights} nights.`, [{ field: 'check_out', message: `Minimum ${rt.min_nights} nights.` }]);
  const price = priceStay(await loadRules(q, rt.room_type_id), p.check_in, p.check_out);
  if (price.total === null) throw conflict('No approved rate for every night of this stay.', 'NO_APPROVED_RATE');
  if (!opts.hold) await reserveStock(q, rt, p.check_in, p.check_out);        // a hold has taken the stock already

  let guestId = p.guest_id;
  if (guestId) { const [g] = await q('select guest_id from guests where guest_id=$1 and (property_id is null or property_id=$2) and deleted_at is null', [guestId, propertyId]); if (!g) throw notFound('Guest not found.'); }
  else {
    const g = p.guest;
    [{ guest_id: guestId }] = await q('insert into guests(full_name,phone,email,nationality,id_passport_no,address,property_id) values($1,$2,$3,$4,$5,$6,$7) returning guest_id',
      [g.full_name.trim(), g.phone || null, g.email || null, g.nationality || null, g.id_passport_no || null, g.address || null, propertyId]);
  }
  const [prop] = await q('select currency_code from properties where property_id=$1', [propertyId]);
  let ref;
  for (let i = 0; i < 10; i++) { ref = 'R-' + Math.random().toString(36).slice(2, 8).toUpperCase(); if (!(await q('select 1 x from reservations where reservation_ref=$1', [ref])).length) break; }
  const [r] = await q(`insert into reservations(reservation_ref,property_id,guest_id,source_id,check_in_date,check_out_date,estimated_arrival,total_guests,special_requests,notes)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning reservation_id, reservation_ref`,
    [ref, propertyId, guestId, Number(p.source_id) || 1, p.check_in, p.check_out, p.estimated_arrival || null, guests, p.special_requests || null, p.notes || null]);
  await q('insert into reservation_rooms(reservation_id,room_type_id,rate_total) values($1,$2,$3)', [r.reservation_id, rt.room_type_id, price.total]);
  const cfg = await settings(q, propertyId);                          // the tax rate of the day is recorded on the folio (S097, S099)
  const [fo] = await q('insert into folios(reservation_id,currency_code,tax_name,tax_rate_pct) values($1,$2,$3,$4) returning folio_id', [r.reservation_id, prop.currency_code, cfg.tax_name, cfg.tax_rate_pct]);
  for (const nt of price.nights)
    await q(`insert into charges(folio_id,charge_type,description,quantity,unit_price,amount,stay_date) values($1,'ROOM',$2,1,$3,$3,$4)`, [fo.folio_id, `Room night ${nt.date} (${rt.name})`, nt.rate, nt.date]);
  if (opts.hold) await q("update reservation_holds set status='CONFIRMED', reservation_id=$2 where hold_id=$1", [opts.hold.hold_id, r.reservation_id]);
  await audit(q, userId, 'RESERVATION_CREATED', 'reservations', r.reservation_id, null, { ref, room_type: rt.name, check_in: p.check_in, check_out: p.check_out, total: price.total, hold_id: opts.hold ? opts.hold.hold_id : undefined });
  return r;
}

// A reservation outside the caller's property looks exactly like a missing one (404), never 403 (S057).
const getReservation = async (q, propertyId, id) => {
  const [r] = await q(`select r.reservation_id, r.reservation_ref, r.check_in_date::text check_in, r.check_out_date::text check_out, r.estimated_arrival::text estimated_arrival,
      r.total_guests, r.status, r.payment_status, r.special_requests, r.notes, r.created_at, r.status_remark, r.status_changed_at, r.checked_in_at, r.checked_out_at,
      g.guest_id, g.full_name, g.phone, g.email, g.nationality, g.id_passport_no, g.address, s.name source,
      rr.reservation_room_id, rr.room_type_id, rr.room_id, rr.rate_total::float8 rate_total, t.name room_type, rm.room_number,
      f.folio_id, f.closed_at
    from reservations r join guests g using(guest_id) join booking_sources s using(source_id)
    join reservation_rooms rr using(reservation_id) join room_types t on t.room_type_id=rr.room_type_id
    left join rooms rm on rm.room_id=rr.room_id join folios f using(reservation_id)
    where r.reservation_id=$1 and r.property_id=$2`, [id, propertyId]);
  if (!r) throw notFound('Reservation not found.');
  Object.assign(r, await folioParts(q, r.folio_id));
  return r;
};

async function recalcPayment(q, reservationId) {
  const [f] = await q('select folio_id from folios where reservation_id=$1', [reservationId]);
  const t = await folioTotals(q, f.folio_id);
  const st = t.net_paid <= 0 ? 'UNPAID' : (t.net_paid + 0.001 >= t.total ? 'PAID' : 'PARTIAL');
  await q('update reservations set payment_status=$2 where reservation_id=$1', [reservationId, st]);
  return st;
}

// a room is free for a stay if it is not blocked and no active reservation overlaps (FR-08)
const roomOverlapSql = `not exists (select 1 from reservation_rooms rr join reservations x on x.reservation_id=rr.reservation_id
  where rr.room_id=r.room_id and x.status in ('CONFIRMED','CHECKED_IN') and x.reservation_id is distinct from $4::uuid
  and x.check_in_date < $3::date and x.check_out_date > $2::date)`;
const freeRooms = (q, typeId, from, to, excludeId, mustBeAvailable) =>
  q(`select r.room_id, r.room_number, st.code status from rooms r join room_statuses st using(status_id)
     where r.room_type_id=$1 and r.status_id<>4 ${mustBeAvailable ? 'and r.status_id=1' : ''} and ${roomOverlapSql} order by r.room_number`,
    [typeId, from, to, excludeId || null]);

module.exports = { money, folioTotals, folioParts, settings, ROOM_MOVES, STATUS_ID, moveRoom, EVENTS, notify, iso, today, addDays, isDate, nightsList, audit, pickRule, loadRules, priceStay, checkDates, lockStock, reserveStock, releaseStock, lockRanges, sweepHolds,
  availability, createReservation, matches, inForce, explainNight, getReservation, recalcPayment, freeRooms, hashPassword };
