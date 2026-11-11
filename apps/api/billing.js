// M13 billing (S097 to S102): folio, charges, discounts, tax, payments and deposits, refunds, invoice and receipt data, reconciliation.
// Money is decided in one place: service.folioTotals. Every change that moves money locks the folio row first, so two people
// paying or refunding at the same moment cannot overpay or refund twice.
const S = require('./service');
const { bad, notFound, conflict, forbidden, Fields, isUuid } = require('./errors');

const METHODS = ['CASH', 'CARD', 'ONLINE', 'BANK_TRANSFER'];
const pad = n => String(n).padStart(6, '0');

module.exports = function mount(app, { getDb, auth, need, wrap }) {
  const db = () => getDb();
  const q = (s, p) => db().q(s, p);
  const prop = req => req.user.property_id;
  const money = S.money;
  const view = (req, id) => S.getReservation(q, prop(req), id);
  const lockFolio = (t, folioId) => t.q('select folio_id from folios where folio_id=$1 for update', [folioId]);
  const reason = (f, b, name = 'reason', min = 3) => {
    const v = typeof b[name] === 'string' ? b[name].trim() : '';
    if (v.length < min || v.length > 200) f.add(name, `Give a reason of ${min} to 200 characters.`);
    return v;
  };
  const openFolio = r => {
    if (r.status === 'CANCELLED') throw conflict('The reservation is cancelled.', 'INVALID_STATE');
    if (r.closed_at) throw conflict('This folio is closed.', 'FOLIO_CLOSED');
  };

  // ---------- S097 the folio ----------
  async function getFolio(req, id) {
    const r = await view(req, id);
    const [fo] = await q('select folio_id, invoice_no, currency_code, opened_at, closed_at, tax_name from folios where folio_id=$1', [r.folio_id]);
    return { reservation_id: r.reservation_id, reservation_ref: r.reservation_ref, status: r.status, ...fo, invoice_ref: 'INV-' + pad(fo.invoice_no),
      charges: r.charges, voided_charges: r.voided_charges, discounts: r.discounts, payments: r.payments, refunds: r.refunds,
      subtotal: r.subtotal, discount_total: r.discount_total, tax_rate_pct: r.tax_rate_pct, tax_total: r.tax_total, total: r.total_charges,
      total_paid: r.total_paid, total_refunded: r.total_refunded, balance: r.balance, payment_status: r.payment_status };
  }
  app.get('/api/reservations/:id/folio', auth, need('folio.manage'), wrap(async (req, res) => res.json(await getFolio(req, req.params.id))));

  // ---------- S098 room charges (made by the reservation) and additional or add-on charges ----------
  app.post('/api/reservations/:id/charges', auth, need('folio.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), fromAddOn = b.add_on_id !== undefined && b.add_on_id !== null;
    if (fromAddOn && !isUuid(b.add_on_id)) f.add('add_on_id', 'Must be a UUID.');
    if (!fromAddOn || b.description !== undefined) {
      if (typeof b.description !== 'string' || !b.description.trim()) f.add('description', 'Description is required.');
      else if (b.description.length > 200) f.add('description', 'At most 200 characters.');
    }
    const qty = b.quantity === undefined ? 1 : Number(b.quantity);
    if (b.quantity !== undefined && !(qty > 0)) f.add('quantity', 'Quantity must be greater than 0.');
    if (!fromAddOn && (b.unit_price === undefined || b.unit_price === '' || !(Number(b.unit_price) >= 0))) f.add('unit_price', 'Unit price must be a number of 0 or more.');
    if (fromAddOn && b.unit_price !== undefined) f.add('unit_price', 'The price comes from the approved add-on. Leave it out.');
    f.check();
    await db().tx(async t => {
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      await lockFolio(t, r.folio_id);
      openFolio(r);
      let desc = (b.description || '').trim(), unit = b.unit_price, q2 = qty, type = 'ADDITIONAL', addOnId = null;
      if (fromAddOn) {                                                         // S069, S098: the approved price of this moment is recorded; later price changes never touch it
        const [a] = await t.q('select add_on_id, name, pricing_unit, unit_price::float8 unit_price, approval_status, is_active from add_ons where add_on_id=$1 and property_id=$2', [b.add_on_id, prop(req)]);
        if (!a) throw notFound('Add-on not found.');
        if (a.approval_status !== 'APPROVED' || !a.is_active) throw conflict('This add-on is not available.', 'INVALID_STATE');
        desc = desc || a.name; unit = a.unit_price; type = 'ADD_ON'; addOnId = a.add_on_id;
        if (b.quantity === undefined) q2 = a.pricing_unit === 'PER_NIGHT' ? S.nightsList(r.check_in, r.check_out).length : a.pricing_unit === 'PER_GUEST' ? r.total_guests : 1;
      }
      const amount = money(q2 * Number(unit));
      const [c] = await t.q(`insert into charges(folio_id,charge_type,description,quantity,unit_price,amount,add_on_id) values($1,$2,$3,$4,$5,$6,$7) returning charge_id`, [r.folio_id, type, desc, q2, unit, amount, addOnId]);
      await S.recalcPayment(t.q, r.reservation_id);
      await S.audit(t.q, req.user.user_id, 'CHARGE_POSTED', 'charges', c.charge_id, null, { description: desc, amount, add_on_id: addOnId });
    });
    res.status(201).json(await view(req, req.params.id));
  }));

  // a mistaken charge is voided with a reason, never edited or deleted (the database refuses both). Room nights change through the reservation.
  app.post('/api/reservations/:id/charges/:chargeId/void', auth, need('folio.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), why = reason(f, b);
    if (!isUuid(req.params.chargeId)) f.add('chargeId', 'Must be a UUID.');
    f.check();
    await db().tx(async t => {
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      await lockFolio(t, r.folio_id);
      openFolio(r);
      const [c] = await t.q('select charge_id, charge_type, description, amount::float8 amount, voided_at from charges where charge_id=$1 and folio_id=$2', [req.params.chargeId, r.folio_id]);
      if (!c) throw notFound('Charge not found.');
      if (c.voided_at) throw conflict('This charge is already voided.', 'INVALID_STATE');
      if (c.charge_type === 'ROOM') throw conflict('Room nights change by editing the reservation. To waive a night, give a discount.', 'INVALID_STATE');
      await t.q('update charges set voided_at=now(), voided_by=$2, void_reason=$3 where charge_id=$1 and voided_at is null', [c.charge_id, req.user.user_id, why]);
      const tot = await S.folioTotals(t.q, r.folio_id);
      if (tot.balance < -0.001) throw conflict(`Payments already received are more than the new total. Refund ${(-tot.balance).toFixed(2)} first.`, 'INVALID_STATE');
      await S.recalcPayment(t.q, r.reservation_id);
      await S.audit(t.q, req.user.user_id, 'CHARGE_VOIDED', 'charges', c.charge_id, { description: c.description, amount: c.amount }, { reason: why });
    });
    res.json(await view(req, req.params.id));
  }));

  // ---------- S099 discounts (tax comes from the property settings and is recorded on the folio) ----------
  app.post('/api/reservations/:id/discounts', auth, need('billing.discount'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), why = reason(f, b), v = Number(b.value);
    if (!['PERCENT', 'FIXED'].includes(b.kind)) f.add('kind', 'Must be PERCENT or FIXED.');
    if (!(v > 0) || (b.kind === 'PERCENT' && v > 100) || Math.abs(money(v) - v) > 1e-9) f.add('value', b.kind === 'PERCENT' ? 'A percentage above 0 and up to 100, with at most 2 decimals.' : 'An amount above 0 with at most 2 decimals.');
    f.check();
    await db().tx(async t => {
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      await lockFolio(t, r.folio_id);
      openFolio(r);
      const tot = await S.folioTotals(t.q, r.folio_id), room = money(tot.subtotal - tot.discount_total);
      const amount = b.kind === 'PERCENT' ? money(room * v / 100) : money(v);       // recorded now: a later charge does not change a discount already given
      if (!(amount > 0) || amount > room + 0.001) throw bad(`The discount must be more than 0 and at most the remaining ${room.toFixed(2)}.`, [{ field: 'value', message: `At most ${room.toFixed(2)} can still be discounted.` }]);
      const newTotal = money((room - amount) * (1 + tot.tax_rate_pct / 100));
      if (newTotal < tot.net_paid - 0.001) throw conflict('Payments already received are more than the new total. Refund first.', 'INVALID_STATE');
      const [d] = await t.q('insert into folio_discounts(folio_id,kind,value,amount,reason,applied_by) values($1,$2,$3,$4,$5,$6) returning discount_id', [r.folio_id, b.kind, v, amount, why, req.user.user_id]);
      await S.recalcPayment(t.q, r.reservation_id);
      await S.audit(t.q, req.user.user_id, 'DISCOUNT_APPLIED', 'folio_discounts', d.discount_id, null, { kind: b.kind, value: v, amount, reason: why });
    });
    res.status(201).json(await view(req, req.params.id));
  }));
  app.post('/api/reservations/:id/discounts/:discountId/void', auth, need('billing.discount'), wrap(async (req, res) => {
    const f = new Fields(), why = reason(f, req.body || {});
    if (!isUuid(req.params.discountId)) f.add('discountId', 'Must be a UUID.');
    f.check();
    await db().tx(async t => {
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      await lockFolio(t, r.folio_id);
      openFolio(r);
      const [d] = await t.q('select discount_id, amount::float8 amount, voided_at from folio_discounts where discount_id=$1 and folio_id=$2', [req.params.discountId, r.folio_id]);
      if (!d) throw notFound('Discount not found.');
      if (d.voided_at) throw conflict('This discount is already removed.', 'INVALID_STATE');
      await t.q('update folio_discounts set voided_at=now(), voided_by=$2, void_reason=$3 where discount_id=$1 and voided_at is null', [d.discount_id, req.user.user_id, why]);
      await S.recalcPayment(t.q, r.reservation_id);
      await S.audit(t.q, req.user.user_id, 'DISCOUNT_VOIDED', 'folio_discounts', d.discount_id, { amount: d.amount }, { reason: why });
    });
    res.json(await view(req, req.params.id));
  }));

  // ---------- S100 payments and deposits with duplicate protection ----------
  // Protection: (1) the same Idempotency-Key on the same folio returns the first payment and records nothing new;
  // (2) a gateway reference can be used once; (3) the folio is locked, so two payments cannot both fit one balance.
  app.post('/api/reservations/:id/payments', auth, need('folio.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), amount = money(b.amount), kind = b.kind === undefined ? 'PAYMENT' : b.kind;
    if (!(amount > 0)) f.add('amount', 'Payment amount must be greater than 0.');
    if (!METHODS.includes(b.method)) f.add('method', 'Must be CASH, CARD, ONLINE or BANK_TRANSFER.');
    if (!['PAYMENT', 'DEPOSIT'].includes(kind)) f.add('kind', 'Must be PAYMENT or DEPOSIT.');
    const ref = b.reference === undefined || b.reference === null || b.reference === '' ? null : String(b.reference).trim();
    if (ref !== null && (!ref || ref.length > 80)) f.add('reference', 'At most 80 characters.');
    if (b.method === 'ONLINE' && !ref) f.add('reference', 'An online payment needs the gateway reference.');
    const note = b.note === undefined || b.note === null || b.note === '' ? null : String(b.note).trim();
    if (note !== null && note.length > 200) f.add('note', 'At most 200 characters.');
    const rawKey = req.get('Idempotency-Key') ?? b.idempotency_key, key = rawKey === undefined || rawKey === null || rawKey === '' ? null : String(rawKey).trim();
    if (key !== null && (!key || key.length > 80)) f.add('idempotency_key', 'At most 80 characters.');
    f.check();
    let replay = false;
    await db().tx(async t => {
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      await lockFolio(t, r.folio_id);
      if (key) {
        const [old] = await t.q('select amount::float8 amount, method, kind from payments where folio_id=$1 and idempotency_key=$2', [r.folio_id, key]);
        if (old) {
          if (old.amount !== amount || old.method !== b.method || old.kind !== kind) throw conflict('This Idempotency-Key was already used for a different payment.', 'CONFLICT', [{ field: 'idempotency_key', message: 'Already used for a different payment.' }]);
          replay = true; return;
        }
      }
      if (b.currency_code !== undefined) {
        const [fo] = await t.q('select currency_code from folios where folio_id=$1', [r.folio_id]);
        if (String(b.currency_code).toUpperCase() !== fo.currency_code) throw bad(`The folio is in ${fo.currency_code}.`, [{ field: 'currency_code', message: `Must be ${fo.currency_code}.` }]);
      }
      if (ref && (await t.q('select 1 x from payments where gateway_reference=$1', [ref])).length) throw conflict('This reference was already recorded.', 'CONFLICT', [{ field: 'reference', message: 'Already recorded.' }]);
      openFolio(r);
      const bal = (await S.folioTotals(t.q, r.folio_id)).balance;                  // read after the lock
      if (amount > bal + 0.001) throw bad(`Payment is more than the balance of ${bal.toFixed(2)}.`, [{ field: 'amount', message: `At most ${Math.max(bal, 0).toFixed(2)}.` }]);
      const [p] = await t.q(`insert into payments(folio_id,amount,currency_code,method,kind,gateway_reference,idempotency_key,received_by,note)
        values($1,$2,(select currency_code from folios where folio_id=$1),$3,$4,$5,$6,$7,$8) returning payment_id`, [r.folio_id, amount, b.method, kind, ref, key, req.user.user_id, note]);
      const st = await S.recalcPayment(t.q, r.reservation_id);
      await S.audit(t.q, req.user.user_id, 'PAYMENT_RECORDED', 'payments', p.payment_id, null, { amount, method: b.method, kind, payment_status: st });
    });
    if (replay) res.set('Idempotent-Replay', 'true');
    res.status(replay ? 200 : 201).json(await view(req, req.params.id));
  }));

  // ---------- S101 refunds: requested by anyone who handles folios, approved by someone else with refund rights ----------
  const refundRow = `select rf.refund_id, rf.refund_no, rf.payment_id, rf.folio_id, rf.amount::float8 amount, rf.reason, rf.status, rf.requested_at, rf.decided_at, rf.decision_note,
      r.reservation_id, r.reservation_ref, g.full_name guest, p.method, p.amount::float8 payment_amount, ru.full_name requested_by, du.full_name decided_by
    from refunds rf join payments p using(payment_id) join folios fo on fo.folio_id=rf.folio_id join reservations r on r.reservation_id=fo.reservation_id join guests g using(guest_id)
    left join users ru on ru.user_id=rf.requested_by left join users du on du.user_id=rf.decided_by`;
  const shape = r => ({ ...r, refund_ref: 'RF-' + pad(r.refund_no) });
  app.get('/api/refunds', auth, need('folio.manage'), wrap(async (req, res) => {
    const st = req.query.status;
    if (st !== undefined && !['REQUESTED', 'COMPLETED', 'REJECTED'].includes(st)) throw bad('Invalid status.', [{ field: 'status', message: 'Must be REQUESTED, COMPLETED or REJECTED.' }]);
    res.json((await q(`${refundRow} where r.property_id=$1 ${st ? 'and rf.status=$2' : ''} order by rf.requested_at desc limit 200`, st ? [prop(req), st] : [prop(req)])).map(shape));
  }));
  app.post('/api/refunds', auth, need('folio.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), amount = money(b.amount), why = reason(f, b);
    if (!isUuid(b.payment_id)) f.add('payment_id', 'Choose the payment to refund.');
    if (!(amount > 0)) f.add('amount', 'Refund amount must be greater than 0.');
    f.check();
    const id = await db().tx(async t => {
      const [p] = await t.q(`select p.payment_id, p.folio_id, p.amount::float8 amount, p.status, r.reservation_id from payments p join folios fo using(folio_id) join reservations r using(reservation_id)
        where p.payment_id=$1 and r.property_id=$2`, [b.payment_id, prop(req)]);
      if (!p) throw notFound('Payment not found.');
      await lockFolio(t, p.folio_id);
      if (p.status !== 'COMPLETED') throw conflict('Only a completed payment can be refunded.', 'INVALID_STATE');
      const [u] = await t.q("select coalesce(sum(amount),0)::float8 used from refunds where payment_id=$1 and status in ('REQUESTED','COMPLETED')", [p.payment_id]);
      const left = money(p.amount - u.used);
      if (amount > left + 0.001) throw bad(`At most ${left.toFixed(2)} of this payment can still be refunded.`, [{ field: 'amount', message: `At most ${Math.max(left, 0).toFixed(2)}.` }]);
      const [x] = await t.q('insert into refunds(payment_id,folio_id,amount,reason,requested_by) values($1,$2,$3,$4,$5) returning refund_id, refund_no', [p.payment_id, p.folio_id, amount, why, req.user.user_id]);
      await S.audit(t.q, req.user.user_id, 'REFUND_REQUESTED', 'refunds', x.refund_id, null, { payment_id: p.payment_id, amount, reason: why });
      await S.notify(t.q, prop(req), 'REFUND_REQUESTED', `Refund RF-${pad(x.refund_no)} of ${amount.toFixed(2)} needs approval`, { refund_id: x.refund_id, reservation_id: p.reservation_id });
      return x.refund_id;
    });
    res.status(201).json(shape((await q(`${refundRow} where rf.refund_id=$1`, [id]))[0]));
  }));
  async function decide(req, res, to) {
    const b = req.body || {}, f = new Fields();
    const note = b.note === undefined || b.note === null || b.note === '' ? null : String(b.note).trim();
    if (note !== null && note.length > 200) f.add('note', 'At most 200 characters.');
    f.check();
    await db().tx(async t => {
      const [x] = await t.q(`select rf.refund_id, rf.refund_no, rf.payment_id, rf.folio_id, rf.amount::float8 amount, rf.status, rf.requested_by, fo.reservation_id
        from refunds rf join folios fo using(folio_id) join reservations r using(reservation_id) where rf.refund_id=$1 and r.property_id=$2`, [req.params.id, prop(req)]);
      if (!x) throw notFound('Refund not found.');
      await lockFolio(t, x.folio_id);
      const [cur] = await t.q('select status from refunds where refund_id=$1 for update', [x.refund_id]);
      if (cur.status !== 'REQUESTED') throw conflict(`This refund is already ${cur.status}.`, 'INVALID_STATE');
      if (x.requested_by === req.user.user_id) throw forbidden('A refund must be decided by someone other than the person who requested it.');
      if (to === 'COMPLETED') {
        const [p] = await t.q('select amount::float8 amount from payments where payment_id=$1', [x.payment_id]);
        const [u] = await t.q("select coalesce(sum(amount),0)::float8 used from refunds where payment_id=$1 and status='COMPLETED'", [x.payment_id]);
        if (x.amount > money(p.amount - u.used) + 0.001) throw conflict('The payment no longer has this much left to refund.', 'INVALID_STATE');
      }
      const [u] = await t.q('update refunds set status=$2, decided_by=$3, decided_at=now(), decision_note=$4 where refund_id=$1 and status=\'REQUESTED\' returning refund_id', [x.refund_id, to, req.user.user_id, note]);
      if (!u) throw conflict('The refund was decided by someone else.', 'INVALID_STATE');
      await S.recalcPayment(t.q, x.reservation_id);
      await S.audit(t.q, req.user.user_id, to === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_REJECTED', 'refunds', x.refund_id, { status: 'REQUESTED' }, { status: to, amount: x.amount, note });
      await S.notify(t.q, prop(req), 'REFUND_DECIDED', `Refund RF-${pad(x.refund_no)} was ${to === 'COMPLETED' ? 'approved' : 'rejected'}`, { refund_id: x.refund_id }, [x.requested_by]);
    });
    res.json(shape((await q(`${refundRow} where rf.refund_id=$1`, [req.params.id]))[0]));
  }
  app.post('/api/refunds/:id/approve', auth, need('billing.refund'), wrap((req, res) => decide(req, res, 'COMPLETED')));
  app.post('/api/refunds/:id/reject', auth, need('billing.refund'), wrap((req, res) => decide(req, res, 'REJECTED')));

  // ---------- S102 invoice and receipt data (the data a screen or PDF is made from) ----------
  const parties = async (req, r) => {
    const [pr] = await q('select name, address, currency_code from properties where property_id=$1', [prop(req)]);
    return { property: pr, guest: { full_name: r.full_name, phone: r.phone, email: r.email, address: r.address, id_passport_no: r.id_passport_no },
      reservation: { reservation_ref: r.reservation_ref, status: r.status, check_in: r.check_in, check_out: r.check_out, nights: S.nightsList(r.check_in, r.check_out).length, room_type: r.room_type, room_number: r.room_number, source: r.source } };
  };
  app.get('/api/reservations/:id/invoice', auth, need('folio.manage'), wrap(async (req, res) => {
    const r = await view(req, req.params.id), fo = await getFolio(req, req.params.id), cfg = await S.settings(q, prop(req));
    res.json({ invoice_no: fo.invoice_ref, issued_at: new Date().toISOString(), state: fo.closed_at ? 'FINAL' : 'DRAFT', ...(await parties(req, r)), currency_code: fo.currency_code,
      lines: fo.charges.map(c => ({ description: c.description, charge_type: c.charge_type, stay_date: c.stay_date, quantity: c.quantity, unit_price: c.unit_price, amount: c.amount })),
      subtotal: fo.subtotal, discounts: fo.discounts.map(d => ({ reason: d.reason, kind: d.kind, amount: d.amount })), discount_total: fo.discount_total,
      tax_name: fo.tax_name, tax_rate_pct: fo.tax_rate_pct, tax_total: fo.tax_total, total: fo.total,
      payments: fo.payments.map(p => ({ receipt_no: 'RC-' + pad(p.receipt_no), kind: p.kind, method: p.method, amount: p.amount, paid_at: p.paid_at })),
      refunds: fo.refunds.filter(x => x.status === 'COMPLETED').map(x => ({ refund_no: 'RF-' + pad(x.refund_no), amount: x.amount, decided_at: x.decided_at })),
      total_paid: fo.total_paid, total_refunded: fo.total_refunded, balance: fo.balance, cancellation_policy: cfg.cancellation_policy });
  }));
  // settlement receipt (FR-11): every payment and refund of the stay and the balance left
  app.get('/api/reservations/:id/receipt', auth, need('folio.manage'), wrap(async (req, res) => {
    const r = await view(req, req.params.id), fo = await getFolio(req, req.params.id);
    res.json({ receipt_for: 'Reservation ' + r.reservation_ref, issued_at: new Date().toISOString(), ...(await parties(req, r)), currency_code: fo.currency_code, invoice_no: fo.invoice_ref,
      payments: fo.payments.map(p => ({ receipt_no: 'RC-' + pad(p.receipt_no), kind: p.kind, method: p.method, amount: p.amount, paid_at: p.paid_at })),
      refunds: fo.refunds.filter(x => x.status === 'COMPLETED').map(x => ({ refund_no: 'RF-' + pad(x.refund_no), amount: x.amount })),
      total: fo.total, total_paid: fo.total_paid, total_refunded: fo.total_refunded, balance: fo.balance, settled: fo.balance <= 0.001 });
  }));
  app.get('/api/payments/:id/receipt', auth, need('folio.manage'), wrap(async (req, res) => {
    const [p] = await q(`select p.payment_id, p.receipt_no, p.kind, p.method, p.amount::float8 amount, p.currency_code, p.gateway_reference, p.paid_at, p.note, p.status, r.reservation_id, u.full_name received_by
      from payments p join folios fo using(folio_id) join reservations r using(reservation_id) left join users u on u.user_id=p.received_by where p.payment_id=$1 and r.property_id=$2`, [req.params.id, prop(req)]);
    if (!p) throw notFound('Payment not found.');
    const r = await view(req, p.reservation_id);
    res.json({ receipt_no: 'RC-' + pad(p.receipt_no), kind: p.kind, method: p.method, amount: p.amount, currency_code: p.currency_code, reference: p.gateway_reference, paid_at: p.paid_at, note: p.note, status: p.status, received_by: p.received_by,
      ...(await parties(req, r)), balance_now: r.balance });
  }));

  // ---------- S101 reconciliation: what came in and went out on a day, and folios whose numbers do not agree ----------
  app.get('/api/reconciliation', auth, need('reports.full'), wrap(async (req, res) => {
    const date = req.query.date === undefined || req.query.date === '' ? S.today() : req.query.date;
    if (!S.isDate(date)) throw bad('Date must be YYYY-MM-DD.', [{ field: 'date', message: 'Must be a date (YYYY-MM-DD).' }]);
    const day = col => `((${col} at time zone 'UTC') + interval '8 hours')::date = $2::date`;
    const pay = await q(`select p.method, p.kind, count(*)::int n, coalesce(sum(p.amount),0)::float8 total from payments p join folios fo using(folio_id) join reservations r using(reservation_id)
      where r.property_id=$1 and p.status='COMPLETED' and ${day('p.paid_at')} group by 1, 2`, [prop(req), date]);
    const ref = await q(`select p.method, count(*)::int n, coalesce(sum(rf.amount),0)::float8 total from refunds rf join payments p using(payment_id) join folios fo on fo.folio_id=rf.folio_id join reservations r using(reservation_id)
      where r.property_id=$1 and rf.status='COMPLETED' and ${day('rf.decided_at')} group by 1`, [prop(req), date]);
    const by = {};
    for (const m of METHODS) by[m] = { method: m, payments: 0, deposits: 0, refunds: 0, net: 0, count: 0 };
    for (const x of pay) { const e = by[x.method]; e[x.kind === 'DEPOSIT' ? 'deposits' : 'payments'] += x.total; e.count += x.n; }
    for (const x of ref) { by[x.method].refunds += x.total; by[x.method].count += x.n; }
    const rows = Object.values(by).map(e => ({ ...e, payments: money(e.payments), deposits: money(e.deposits), refunds: money(e.refunds), net: money(e.payments + e.deposits - e.refunds) }));
    const totals = rows.reduce((a, e) => ({ payments: money(a.payments + e.payments), deposits: money(a.deposits + e.deposits), refunds: money(a.refunds + e.refunds), net: money(a.net + e.net) }), { payments: 0, deposits: 0, refunds: 0, net: 0 });
    // folio checks over the whole property
    const issues = [];
    for (const f of await q(`select fo.folio_id, r.reservation_ref, r.payment_status from folios fo join reservations r using(reservation_id)
        where r.property_id=$1 and (exists (select 1 from payments where folio_id=fo.folio_id) or exists (select 1 from refunds where folio_id=fo.folio_id)) order by r.reservation_ref`, [prop(req)])) {
      const t = await S.folioTotals(q, f.folio_id);
      const want = t.net_paid <= 0 ? 'UNPAID' : (t.net_paid + 0.001 >= t.total ? 'PAID' : 'PARTIAL');
      if (t.total_refunded > t.total_paid + 0.001) issues.push({ reservation_ref: f.reservation_ref, issue: 'REFUNDS_EXCEED_PAYMENTS', detail: `refunded ${t.total_refunded.toFixed(2)}, paid ${t.total_paid.toFixed(2)}` });
      if (t.balance < -0.001) issues.push({ reservation_ref: f.reservation_ref, issue: 'OVERPAID', detail: `balance ${t.balance.toFixed(2)}` });
      if (f.payment_status !== want) issues.push({ reservation_ref: f.reservation_ref, issue: 'PAYMENT_STATUS_MISMATCH', detail: `shows ${f.payment_status}, figures say ${want}` });
    }
    const [open] = await q("select count(*)::int n from refunds rf join folios fo using(folio_id) join reservations r using(reservation_id) where r.property_id=$1 and rf.status='REQUESTED'", [prop(req)]);
    res.json({ date, by_method: rows, totals, open_refund_requests: open.n, issues, balanced: issues.length === 0 });
  }));
};
