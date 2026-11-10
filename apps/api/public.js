// M21 (S166 to S175): the guest booking engine API. It uses the same stock, prices and rules as the front desk (SRS 13.2).
// Nothing here needs a sign-in, so every rule is enforced on the server and the guest only holds a booking token for his own attempt.
//   availability -> booking attempt (hold + server price) -> payment session -> gateway webhook (verified) -> confirmed reservation
const crypto = require('crypto');
const S = require('./service');
const Cancellation = require('./cancellation');
const { HttpError, bad, notFound, conflict, Fields, isUuid } = require('./errors');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()\-]{5,28}$/;
const PRICE_KEYS = ['total', 'subtotal', 'price', 'rate', 'amount', 'amount_due', 'tax', 'tax_total', 'nightly', 'currency_code'];   // the server decides these (S169)
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const webhookSecret = () => process.env.PAYMENT_WEBHOOK_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-webhook-secret');

const hits = new Map();
module.exports = function mount(app, { getDb, wrap }) {
  const db = () => getDb(), q = (s, p) => db().q(s, p);

  // ---- a small per-address limit: the booking engine is open to the internet and a booking attempt holds a room ----
  const limit = (name, dflt) => (req, res, next) => {
    const max = Number(process.env['PUBLIC_LIMIT_' + name]) || dflt, now = Date.now(), key = name + ':' + req.ip;
    let h = hits.get(key); if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; hits.set(key, h); }
    if (++h.n > max) return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.'));
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };

  async function propertyOf(raw) {
    if (raw !== undefined && raw !== null && raw !== '') {
      if (!isUuid(raw)) throw bad('Please correct the fields listed.', [{ field: 'property_id', message: 'Must be a property id (UUID).' }]);
      const [p] = await q('select property_id, name, currency_code from properties where property_id=$1', [raw]);
      if (!p) throw notFound('Property not found.');
      return p;
    }
    const all = await q('select property_id, name, currency_code from properties order by created_at limit 2');
    if (all.length !== 1) throw bad('Please correct the fields listed.', [{ field: 'property_id', message: 'Give the property id.' }]);
    return all[0];
  }
  const money = S.money;
  async function quote(qq, propertyId, rt, from, to) {
    const price = S.priceStay(await S.loadRules(qq, rt.room_type_id), from, to);
    if (price.total === null) throw conflict('No approved rate for every night of this stay.', 'NO_APPROVED_RATE');
    const cfg = await S.settings(qq, propertyId), tax = money(price.total * cfg.tax_rate_pct / 100);
    return { nights: price.nights, subtotal: money(price.total), tax_name: cfg.tax_name, tax_rate_pct: cfg.tax_rate_pct, tax_total: tax, total: money(price.total + tax), cfg };
  }

  // ---------- S166 / S167 public availability: approved room types and effective prices only, no guest data ----------
  app.get('/api/public/availability', limit('READ', 120), wrap(async (req, res) => {
    const Q = req.query, p = await propertyOf(Q.property_id);
    const list = await S.availability(q, p.property_id, { from: Q.check_in ?? Q.from, to: Q.check_out ?? Q.to, guests: Q.guests, room_type_id: Q.room_type_id });
    const cfg = await S.settings(q, p.property_id);
    res.json({ property: { property_id: p.property_id, name: p.name, currency_code: p.currency_code, check_in_time: cfg.check_in_time, check_out_time: cfg.check_out_time, cancellation_policy: cfg.cancellation_policy },
      room_types: list.map(t => {
        const tax = t.total === null ? null : money(t.total * cfg.tax_rate_pct / 100);
        return { room_type_id: t.room_type_id, name: t.name, category: t.category, description: t.description, facilities: t.facilities, max_guests: t.max_guests, min_nights: t.min_nights, nights: t.nights,
          available: t.bookable, rooms_left: Math.min(t.rooms_left, 5), nightly: t.nightly, subtotal: t.total, tax_name: cfg.tax_name, tax_rate_pct: cfg.tax_rate_pct, tax_total: tax, total: t.total === null ? null : money(t.total + tax), reasons: t.reasons };
      }) });
  }));

  // ---------- S168 / S169 a booking attempt: server-side validation and price, and a hold that runs out ----------
  const view = a => ({ attempt_id: a.attempt_id, status: a.status, expires_at: a.expires_at, room_type: a.room_type, check_in: a.check_in, check_out: a.check_out, total_guests: a.total_guests,
    guest: { full_name: a.guest_name, email: a.guest_email, phone: a.guest_phone }, currency_code: a.currency_code,
    price: { subtotal: Number(a.subtotal), tax_total: Number(a.tax_total), total: Number(a.total), amount_due: Number(a.amount_due) }, reservation_ref: a.reservation_ref || null,
    payment: a.session_reference ? { reference: a.session_reference, status: a.session_status, amount: Number(a.session_amount) } : null });
  const attemptSql = `select a.*, a.check_in_date::text check_in, a.check_out_date::text check_out, t.name room_type, r.reservation_ref, h.status hold_status, (h.expires_at<now()) hold_overdue,
      s.reference session_reference, s.status session_status, s.amount session_amount
    from booking_attempts a join room_types t using(room_type_id) join reservation_holds h using(hold_id) left join reservations r on r.reservation_id=a.reservation_id
    left join lateral (select * from payment_sessions where attempt_id=a.attempt_id order by created_at desc limit 1) s on true where a.attempt_id=$1`;
  async function attemptFor(qq, req, forUpdate) {
    const tokenHeader = req.get('x-booking-token');
    if (!tokenHeader) throw new HttpError(401, 'UNAUTHENTICATED', 'Send the booking token in the X-Booking-Token header.');
    const [a] = await qq(attemptSql + (forUpdate ? ' for update of a' : ''), [req.params.id]);
    if (!a || !safeEq(sha(tokenHeader), a.token_hash)) throw notFound('Booking not found.');
    return a;
  }

  app.post('/api/public/bookings', limit('BOOK', 20), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    for (const k of PRICE_KEYS) if (b[k] !== undefined) f.add(k, 'Prices are set by the server. Remove this field.');
    const g = b.guest && typeof b.guest === 'object' && !Array.isArray(b.guest) ? b.guest : {};
    const name = typeof g.full_name === 'string' ? g.full_name.trim().replace(/\s+/g, ' ') : '', email = typeof g.email === 'string' ? g.email.trim().toLowerCase() : '';
    const phone = g.phone === undefined || g.phone === null || g.phone === '' ? null : String(g.phone).trim();
    if (name.length < 2 || name.length > 120) f.add('guest.full_name', 'Full name, 2 to 120 characters.');
    if (!EMAIL_RE.test(email) || email.length > 160) f.add('guest.email', 'A valid e-mail address is needed for the confirmation.');
    if (phone !== null && !PHONE_RE.test(phone)) f.add('guest.phone', 'Digits, spaces, + ( ) and - only, 6 to 30 characters.');
    const wants = b.special_requests === undefined || b.special_requests === null || b.special_requests === '' ? null : b.special_requests;
    if (wants !== null && (typeof wants !== 'string' || wants.trim().length > 500)) f.add('special_requests', 'Text of at most 500 characters.');
    const guests = b.total_guests;
    if (!Number.isInteger(guests) || guests < 1 || guests > 20) f.add('total_guests', 'Number of guests, a whole number from 1 to 20.');
    if (!isUuid(b.room_type_id)) f.add('room_type_id', 'Choose a room type.');
    if (b.expected_total !== undefined && !(typeof b.expected_total === 'number' && b.expected_total >= 0)) f.add('expected_total', 'A number.');
    for (const x of S.checkDates(b.check_in, b.check_out).list) f.add(x.field, x.message);
    f.check();
    const p = await propertyOf(b.property_id);
    await S.sweepHolds(q);
    const [open] = await q("select count(*)::int n from booking_attempts where guest_email=$1 and status in ('HOLDING','PAYMENT_PENDING') and expires_at>now()", [email]);
    if (open.n >= 3) throw new HttpError(429, 'RATE_LIMITED', 'This e-mail address already has 3 unpaid bookings in progress. Finish or cancel one first.');
    const out = await db().tx(async t => {
      const [rt] = await t.q(`select t.room_type_id, t.name, t.max_guests, t.min_nights, t.approval_status from room_types t join room_categories c using(category_id) where t.room_type_id=$1 and c.property_id=$2`, [b.room_type_id, p.property_id]);
      if (!rt || rt.approval_status !== 'APPROVED') throw notFound('Room type not found.');
      const n = S.nightsList(b.check_in, b.check_out).length;
      if (n > 90) throw bad('Please correct the fields listed.', [{ field: 'check_out', message: 'At most 90 nights.' }]);
      if (guests > rt.max_guests) throw bad(`${rt.name} allows at most ${rt.max_guests} guests.`, [{ field: 'total_guests', message: `At most ${rt.max_guests} guests.` }]);
      if (n < rt.min_nights) throw bad(`${rt.name} requires at least ${rt.min_nights} nights.`, [{ field: 'check_out', message: `Minimum ${rt.min_nights} nights.` }]);
      const qt = await quote(t.q, p.property_id, rt, b.check_in, b.check_out);
      if (b.expected_total !== undefined && Math.abs(b.expected_total - qt.total) > 0.005) throw conflict(`The price is now ${qt.total.toFixed(2)} ${p.currency_code}.`, 'PRICE_CHANGED');
      await S.reserveStock(t.q, rt, b.check_in, b.check_out);
      const [h] = await t.q(`insert into reservation_holds(room_type_id,check_in_date,check_out_date,total_guests,expires_at) values($1,$2,$3,$4,now()+make_interval(mins => $5)) returning hold_id, expires_at`,
        [rt.room_type_id, b.check_in, b.check_out, guests, qt.cfg.hold_minutes]);
      const due = Math.max(money(qt.total * qt.cfg.online_deposit_pct / 100), 0.01), token = crypto.randomBytes(24).toString('hex');
      const [a] = await t.q(`insert into booking_attempts(property_id,hold_id,room_type_id,check_in_date,check_out_date,total_guests,guest_name,guest_email,guest_phone,special_requests,currency_code,subtotal,tax_total,total,amount_due,token_hash,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning attempt_id`,
        [p.property_id, h.hold_id, rt.room_type_id, b.check_in, b.check_out, guests, name, email, phone, wants && wants.trim(), p.currency_code, qt.subtotal, qt.tax_total, qt.total, due, sha(token), h.expires_at]);
      await S.audit(t.q, null, 'ONLINE_BOOKING_STARTED', 'booking_attempts', a.attempt_id, null, { room_type: rt.name, check_in: b.check_in, check_out: b.check_out, total: qt.total, hold_id: h.hold_id });
      return { id: a.attempt_id, token, nights: qt.nights, qt };
    });
    const [a] = await q(attemptSql, [out.id]);
    res.status(201).json({ ...view(a), access_token: out.token, price: { ...view(a).price, nights: out.nights, tax_name: out.qt.tax_name, tax_rate_pct: out.qt.tax_rate_pct, deposit_pct: out.qt.cfg.online_deposit_pct } });
  }));

  app.get('/api/public/bookings/:id', limit('READ', 120), wrap(async (req, res) => {
    await S.sweepHolds(q);
    res.json(view(await attemptFor(q, req)));
  }));

  // ---------- S173: the guest walks away ----------
  async function releaseHold(t, holdId, why) {
    const [h] = await t.q('select hold_id, room_type_id, check_in_date::text ci, check_out_date::text co, status from reservation_holds where hold_id=$1 for update', [holdId]);
    if (h && h.status === 'ACTIVE') {
      await t.q("update reservation_holds set status='RELEASED' where hold_id=$1 and status='ACTIVE'", [holdId]);
      await S.lockStock(t.q, h.room_type_id, h.ci, h.co);
      await t.q('update room_stock set reserved_rooms=greatest(reserved_rooms-1,0) where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [h.room_type_id, h.ci, h.co]);
      await S.audit(t.q, null, 'HOLD_RELEASED', 'reservation_holds', holdId, { status: 'ACTIVE' }, { status: 'RELEASED', why });
    }
  }
  app.post('/api/public/bookings/:id/cancel', limit('BOOK', 20), wrap(async (req, res) => {
    const tokenOk = await attemptFor(q, req);
    const out = await db().tx(async t => {
      const a = await attemptFor(t.q, req, true);
      if (['HOLDING', 'PAYMENT_PENDING'].includes(a.status)) {
        await t.q("update booking_attempts set status='ABANDONED', updated_at=now() where attempt_id=$1 and status in ('HOLDING','PAYMENT_PENDING')", [a.attempt_id]);
        await t.q("update payment_sessions set status='EXPIRED' where attempt_id=$1 and status='PENDING'", [a.attempt_id]);
        await releaseHold(t, a.hold_id, 'guest left');
        await S.audit(t.q, null, 'ONLINE_BOOKING_ABANDONED', 'booking_attempts', a.attempt_id, { status: a.status }, { status: 'ABANDONED' });
        return { status: 'ABANDONED' };
      }
      if (a.status === 'CONFIRMED') {
        const c = await Cancellation.cancelReservation(t, a.property_id, a.reservation_id, { userId: null, remark: 'Cancelled by the guest online', via: 'GUEST' });
        return { status: 'CANCELLED', reservation_ref: a.reservation_ref, cancel_fee: c.cancel_fee, free_of_charge: c.free_of_charge, refund_requested: c.refund_requested };
      }
      throw conflict(`This booking is ${a.status} and cannot be cancelled.`, 'INVALID_STATE');
    });
    res.json({ attempt_id: tokenOk.attempt_id, ...out });
  }));

  // ---------- S170 payment session: the amount and the reference come from the server ----------
  app.post('/api/public/bookings/:id/payment-session', limit('BOOK', 20), wrap(async (req, res) => {
    await S.sweepHolds(q);
    await attemptFor(q, req);
    const out = await db().tx(async t => {
      const a = await attemptFor(t.q, req, true);
      if (!['HOLDING', 'PAYMENT_PENDING'].includes(a.status) || a.hold_status !== 'ACTIVE' || a.hold_overdue)
        throw conflict(a.status === 'EXPIRED' || a.hold_overdue ? 'The time to pay has run out. Search again.' : `This booking is ${a.status}.`, a.status === 'EXPIRED' || a.hold_overdue ? 'HOLD_EXPIRED' : 'INVALID_STATE');
      let [s] = await t.q("select reference, amount::float8 amount, currency_code, status from payment_sessions where attempt_id=$1 and status='PENDING'", [a.attempt_id]);
      if (!s) {
        const ref = 'PS-' + crypto.randomBytes(8).toString('hex').toUpperCase();
        [s] = await t.q("insert into payment_sessions(attempt_id,reference,amount,currency_code) values($1,$2,$3,$4) returning reference, amount::float8 amount, currency_code, status", [a.attempt_id, ref, a.amount_due, a.currency_code]);
        await t.q("update booking_attempts set status='PAYMENT_PENDING', updated_at=now() where attempt_id=$1", [a.attempt_id]);
        await S.audit(t.q, null, 'PAYMENT_SESSION_CREATED', 'booking_attempts', a.attempt_id, null, { reference: ref, amount: Number(a.amount_due) });
      }
      return { ...s, expires_at: a.expires_at };
    });
    res.status(201).json({ reference: out.reference, amount: out.amount, currency_code: out.currency_code, status: out.status, expires_at: out.expires_at,
      payment_url: `${process.env.PAYMENT_GATEWAY_URL || 'https://gateway.example'}/pay/${out.reference}` });
  }));

  // ---------- S171 / S172 / S173 the payment webhook ----------
  // The gateway signs the raw body with a shared secret (HMAC-SHA256, hex, header X-Signature). Nothing is trusted from the body except
  // the result: amount, currency and reference are compared with the session the server made, and every event id is processed once.
  const sendMail = async (t, a, ref) => {
    const body = `Dear ${a.guest_name},\n\nYour booking ${ref} is confirmed.\nRoom: ${a.room_type}\nCheck-in: ${a.check_in}\nCheck-out: ${a.check_out}\nGuests: ${a.total_guests}\nTotal: ${Number(a.total).toFixed(2)} ${a.currency_code}\n`;
    await t.q('insert into email_outbox(property_id,reservation_id,to_email,subject,body) values($1,$2,$3,$4,$5) on conflict do nothing', [a.property_id, a.reservation_id, a.guest_email, `Booking confirmation ${ref}`, body]);
  };
  async function confirmAttempt(t, a, s, ev) {
    // a: locked attempt, s: its locked session. Returns { outcome, detail }.
    await S.sweepHolds(t.q);
    const [h] = await t.q('select hold_id, status, (expires_at<now()) overdue from reservation_holds where hold_id=$1 for update', [a.hold_id]);
    const live = a.status === 'PAYMENT_PENDING' && h.status === 'ACTIVE' && !h.overdue;
    const stay = { room_type_id: a.room_type_id, check_in: a.check_in, check_out: a.check_out, total_guests: a.total_guests, source_id: 4, special_requests: a.special_requests, guest: { full_name: a.guest_name, email: a.guest_email, phone: a.guest_phone } };
    let reservation;
    if (live) {
      reservation = await S.createReservation(t, a.property_id, stay, null, { hold: h });
    } else {
      // late result (hold gone): take the room again only if it is still free; otherwise the money is on hold for a person to handle
      const stock = await S.lockStock(t.q, a.room_type_id, a.check_in, a.check_out);
      const free = stock.length === S.nightsList(a.check_in, a.check_out).length && stock.every(x => x.reserved_rooms < x.total_rooms);
      const [rt] = await t.q('select room_type_id, name, max_guests, min_nights, approval_status from room_types where room_type_id=$1', [a.room_type_id]);
      if (!free || rt.approval_status !== 'APPROVED') return { outcome: 'UNFULFILLED', detail: 'Paid after the hold ended and the room is gone' };
      reservation = await S.createReservation(t, a.property_id, stay, null);
    }
    const [fo] = await t.q('select folio_id from folios where reservation_id=$1 for update', [reservation.reservation_id]);
    const tot = await S.folioTotals(t.q, fo.folio_id), amount = Number(s.amount);
    await t.q(`insert into payments(folio_id,amount,currency_code,method,kind,gateway_reference,idempotency_key,note) values($1,$2,$3,'ONLINE',$4,$5,$6,$7)`,
      [fo.folio_id, amount, s.currency_code, amount + 0.005 < tot.total ? 'DEPOSIT' : 'PAYMENT', ev.transaction_id || s.reference, ev.event_id, `Online payment ${s.reference}`]);
    await S.recalcPayment(t.q, reservation.reservation_id);
    await t.q("update booking_attempts set status='CONFIRMED', reservation_id=$2, updated_at=now() where attempt_id=$1", [a.attempt_id, reservation.reservation_id]);
    await sendMail(t, { ...a, reservation_id: reservation.reservation_id }, reservation.reservation_ref);
    await S.audit(t.q, null, 'ONLINE_BOOKING_CONFIRMED', 'reservations', reservation.reservation_id, null, { reference: s.reference, amount, attempt_id: a.attempt_id, late: !live });
    return { outcome: 'APPLIED', detail: reservation.reservation_ref, reservation_ref: reservation.reservation_ref, late: !live };
  }

  app.post('/api/public/payments/webhook', wrap(async (req, res) => {
    const secret = webhookSecret();
    if (!secret) throw new HttpError(500, 'INTERNAL_ERROR', 'The payment webhook secret is not configured on the server.');
    const sig = String(req.get('x-signature') || '').replace(/^sha256=/, '');
    const want = crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    if (!req.rawBody || !sig || !safeEq(sig, want)) throw new HttpError(401, 'INVALID_SIGNATURE', 'The signature does not match the body.');
    const ev = req.body || {}, f = new Fields();
    if (typeof ev.event_id !== 'string' || !/^[\w.:-]{1,80}$/.test(ev.event_id)) f.add('event_id', 'Event id, up to 80 letters, digits or . : _ -.');
    if (!['payment.succeeded', 'payment.failed'].includes(ev.type)) f.add('type', 'Must be payment.succeeded or payment.failed.');
    if (typeof ev.reference !== 'string' || ev.reference.length > 40) f.add('reference', 'The payment reference.');
    if (ev.type === 'payment.succeeded') {
      if (!(typeof ev.amount === 'number' && ev.amount > 0)) f.add('amount', 'The amount paid, a number above 0.');
      if (typeof ev.currency !== 'string' || ev.currency.length !== 3) f.add('currency', 'Three-letter currency code.');
    }
    if (ev.transaction_id !== undefined && (typeof ev.transaction_id !== 'string' || ev.transaction_id.length > 80)) f.add('transaction_id', 'At most 80 characters.');
    f.check();
    const result = await db().tx(async t => {
      const [s0] = await t.q('select session_id, attempt_id from payment_sessions where reference=$1', [ev.reference]);
      if (!s0) throw notFound('Unknown payment reference.');
      const [a] = await t.q('select * , check_in_date::text check_in, check_out_date::text check_out, (select name from room_types where room_type_id=booking_attempts.room_type_id) room_type from booking_attempts where attempt_id=$1 for update', [s0.attempt_id]);
      const [s] = await t.q('select session_id, reference, amount::float8 amount, currency_code, status from payment_sessions where session_id=$1 for update', [s0.session_id]);
      const [seen] = await t.q('select outcome from payment_events where event_id=$1', [ev.event_id]);
      if (seen) return { http: 200, body: { status: 'DUPLICATE', outcome: seen.outcome } };
      const log = (outcome, detail) => t.q('insert into payment_events(event_id,reference,event_type,amount,currency_code,outcome,detail) values($1,$2,$3,$4,$5,$6,$7)', [ev.event_id, ev.reference, ev.type, ev.amount ?? null, ev.currency ? ev.currency.toUpperCase() : null, outcome, detail ? String(detail).slice(0, 200) : null]);
      if (ev.type === 'payment.failed') {
        if (s.status !== 'PENDING') { await log('IGNORED', `session is ${s.status}`); return { http: 200, body: { status: 'IGNORED', detail: `session is ${s.status}` } }; }
        await t.q("update payment_sessions set status='FAILED' where session_id=$1", [s.session_id]);
        await t.q("update booking_attempts set status='FAILED', updated_at=now() where attempt_id=$1 and status in ('HOLDING','PAYMENT_PENDING')", [a.attempt_id]);
        await releaseHold(t, a.hold_id, 'payment failed');
        await S.audit(t.q, null, 'ONLINE_PAYMENT_FAILED', 'booking_attempts', a.attempt_id, { status: a.status }, { status: 'FAILED', reference: s.reference });
        await log('FAILED_APPLIED');
        return { http: 200, body: { status: 'FAILED_APPLIED' } };
      }
      // payment.succeeded: the amount, the currency and the reference must be what the server asked for
      if (Math.abs(ev.amount - s.amount) > 0.005 || ev.currency.toUpperCase() !== s.currency_code) {
        await log('REJECTED', `expected ${s.amount} ${s.currency_code}, got ${ev.amount} ${ev.currency}`);
        await S.audit(t.q, null, 'ONLINE_PAYMENT_REJECTED', 'booking_attempts', a.attempt_id, null, { reference: s.reference, expected: s.amount, got: ev.amount, currency: ev.currency });
        await S.notify(t.q, a.property_id, 'BOOKING_PAYMENT_PROBLEM', `Online payment ${s.reference} does not match: expected ${s.amount} ${s.currency_code}, got ${ev.amount} ${ev.currency}`, { attempt_id: a.attempt_id });
        return { http: 409, error: ['PAYMENT_MISMATCH', 'The amount or currency does not match the payment session.'] };
      }
      if (s.status === 'PAID') { await log('IGNORED', 'session already paid'); return { http: 200, body: { status: 'IGNORED', detail: 'session already paid' } }; }
      const c = await confirmAttempt(t, a, s, ev);
      if (c.outcome === 'UNFULFILLED') {
        await t.q("update payment_sessions set status='PAID', paid_at=now(), gateway_txn=$2 where session_id=$1", [s.session_id, ev.transaction_id || null]);
        await t.q("update booking_attempts set status='PAID_UNFULFILLED', updated_at=now() where attempt_id=$1", [a.attempt_id]);
        await S.audit(t.q, null, 'ONLINE_PAYMENT_UNFULFILLED', 'booking_attempts', a.attempt_id, { status: a.status }, { status: 'PAID_UNFULFILLED', reference: s.reference, amount: s.amount });
        await S.notify(t.q, a.property_id, 'BOOKING_PAYMENT_PROBLEM', `Paid online but no room is left: ${s.reference}, ${s.amount.toFixed(2)} ${s.currency_code}. Refund it at the gateway.`, { attempt_id: a.attempt_id });
        await log('UNFULFILLED', c.detail);
        return { http: 200, body: { status: 'UNFULFILLED', detail: c.detail } };
      }
      await t.q("update payment_sessions set status='PAID', paid_at=now(), gateway_txn=$2 where session_id=$1", [s.session_id, ev.transaction_id || null]);
      await log('APPLIED', c.detail);
      return { http: 200, body: { status: 'APPLIED', reservation_ref: c.reservation_ref, late: c.late } };
    });
    if (result.error) {
      const [code, message] = result.error;
      throw conflict(message, code);
    }
    res.status(result.http).json(result.body);
  }));

  // ---------- S174 staff view of the mail waiting to be sent ----------
  app.get('/api/email-outbox', (req, res, next) => require('./auth').authenticate(db())(req, res, next), (req, res, next) => require('./permissions').can(req.user, 'reports.full') ? next() : next(require('./errors').forbidden()),
    wrap(async (req, res) => {
      const st = req.query.status, f = new Fields();
      if (st !== undefined && !['QUEUED', 'SENT', 'FAILED'].includes(st)) f.add('status', 'Must be QUEUED, SENT or FAILED.');
      f.check();
      res.json(await q(`select outbox_id, reservation_id, to_email, subject, status, attempts, last_error, created_at, sent_at from email_outbox where property_id=$1 and ($2::text is null or status=$2) order by created_at desc limit 200`, [req.user.property_id, st || null]));
    }));
};
module.exports.resetLimits = () => hits.clear();
