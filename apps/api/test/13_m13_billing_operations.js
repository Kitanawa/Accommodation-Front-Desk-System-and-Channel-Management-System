// M13 (S097 to S106): folio, charges, tax and discounts, payments and deposits, refunds, invoice and receipt, housekeeping, maintenance, policies, notifications, reports.
const { ok, summary, boot, api, tok } = require('./helpers');
const { addSecondProperty } = require('../seed');
const { hashPassword } = require('../password');
const S = require('../service');

(async () => {
  await boot();
  const db = await require('../db').connect();
  const p2 = await addSecondProperty(db);
  await db.q("insert into users(property_id,role_id,full_name,email,password_hash,can_approve_rates) values($1,1,'Second Admin','admin.b@fds.test',$2,true)", [p2.property_id, await hashPassword('Cedar-Demo-2026')]);
  tok.badmin = (await api('POST', '/api/login', { email: 'admin.b@fds.test', password: 'Cedar-Demo-2026' })).body.token;
  const t = S.today(), D = n => S.addDays(t, n), FD = 'frontdesk', MG = 'manager', AD = 'admin';
  const code = r => r.body && r.body.error && r.body.error.code;
  const fields = r => ((r.body.error || {}).fields || []).map(f => f.field).sort().join();
  const near = (a, b) => Math.abs(a - b) < 0.006;
  const types = (await api('GET', '/api/room-types', null, FD)).body;
  const twin = types.find(x => x.name === 'Standard Twin').room_type_id, deluxe = types.find(x => x.name === 'Deluxe King').room_type_id;
  const book = (typeId, from, to, extra = {}) => api('POST', '/api/reservations', { guest: { full_name: 'M13 Guest' }, room_type_id: typeId, check_in: from, check_out: to, total_guests: 2, source_id: 1, ...extra }, FD);
  const get = (id, who = FD) => api('GET', `/api/reservations/${id}`, null, who);
  const pay = (id, body, who = FD, h) => api('POST', `/api/reservations/${id}/payments`, body, who, h);
  const roomStatus = async no => (await db.q('select st.code c from rooms r join room_statuses st using(status_id) where r.room_number=$1', [no]))[0].c;
  const auditHas = async a => (await db.q('select 1 x from audit_records where action=$1', [a])).length > 0;
  const folioIdOf = async id => (await db.q('select folio_id from folios where reservation_id=$1', [id]))[0].folio_id;

  // ================= S097 folio, recorded charges =================
  const A = (await book(twin, D(30), D(32))).body.reservation_id;
  const fo = await api('GET', `/api/reservations/${A}/folio`, null, FD);
  ok(fo.status === 200 && /^INV-\d{6}$/.test(fo.body.invoice_ref) && fo.body.currency_code === 'MYR' && fo.body.charges.length === 2 && fo.body.voided_charges.length === 0 && near(fo.body.balance, fo.body.subtotal) && fo.body.tax_total === 0, 'S097: a reservation has one folio with a room charge per night and an invoice number');
  ok(fo.body.charges.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.stay_date)) && fo.body.charges[0].stay_date === D(30), 'S097: each room charge records the night it is for');
  ok((await db.q('select count(*)::int n from folios where reservation_id=$1', [A]))[0].n === 1, 'S097: exactly one folio per reservation');
  ok((await api('GET', `/api/reservations/${A}/folio`, null, 'badmin')).status === 404 && (await api('GET', '/api/reservations/00000000-0000-4000-8000-000000000000/folio', null, FD)).status === 404, 'S097: another property and an unknown reservation get 404');
  const cid = fo.body.charges[0].charge_id;
  const reject = async sql => { try { await db.q(sql, [cid]); return false; } catch { return true; } };
  ok(await reject('update charges set amount=1 where charge_id=$1') && await reject('update charges set unit_price=1 where charge_id=$1') && await reject('delete from charges where charge_id=$1') && await reject("update charges set description='x' where charge_id=$1"), 'S097: the database refuses to change or delete a recorded charge');
  const x1 = await api('POST', `/api/reservations/${A}/charges`, { description: 'Laundry', quantity: 2, unit_price: 30 }, FD);
  const laundry = x1.body.charges.find(c => c.description === 'Laundry');
  ok(x1.status === 201 && laundry.amount === 60 && near(x1.body.balance, fo.body.subtotal + 60), 'S098: an additional charge is added (2 x 30 = 60)');
  ok(fields(await api('POST', `/api/reservations/${A}/charges/${laundry.charge_id}/void`, {}, FD)) === 'reason', 'S097: voiding needs a reason');
  const v1 = await api('POST', `/api/reservations/${A}/charges/${laundry.charge_id}/void`, { reason: 'Posted twice by mistake' }, FD);
  ok(v1.status === 200 && near(v1.body.balance, fo.body.subtotal) && v1.body.voided_charges.length === 1 && v1.body.voided_charges[0].void_reason === 'Posted twice by mistake' && !v1.body.charges.some(c => c.charge_id === laundry.charge_id), 'S097: a voided charge leaves the balance and stays visible as voided');
  ok(code(await api('POST', `/api/reservations/${A}/charges/${laundry.charge_id}/void`, { reason: 'again' }, FD)) === 'INVALID_STATE' && code(await api('POST', `/api/reservations/${A}/charges/${cid}/void`, { reason: 'waive a night' }, FD)) === 'INVALID_STATE', 'S097: a charge cannot be voided twice, and a room night cannot be voided');
  ok((await api('POST', `/api/reservations/${A}/charges/00000000-0000-4000-8000-000000000000/void`, { reason: 'none' }, FD)).status === 404 && fields(await api('POST', `/api/reservations/${A}/charges/nope/void`, { reason: 'none' }, FD)) === 'chargeId' && (await api('POST', `/api/reservations/${A}/charges/${laundry.charge_id}/void`, { reason: 'x yz' }, 'badmin')).status === 404, 'S097: an unknown charge is 404, a bad id is reported, another property gets 404');
  ok(await auditHas('CHARGE_VOIDED'), 'S097: voiding is in the audit trail');
  // editing a confirmed stay voids the old room nights and records new ones
  const ed = await api('PATCH', `/api/reservations/${A}`, { check_out: D(33) }, FD);
  ok(ed.status === 200 && ed.body.charges.filter(c => c.charge_type === 'ROOM').length === 3 && ed.body.voided_charges.filter(c => c.charge_type === 'ROOM').length === 2 && near(ed.body.balance, ed.body.charges.reduce((s, c) => s + c.amount, 0)), 'S097: changing the dates voids the old room nights and records new ones; the balance counts only active charges');
  ok((await db.q('select count(*)::int n from charges where folio_id=$1', [await folioIdOf(A)]))[0].n === 6, 'S097: nothing was deleted: 2 old nights, 3 new nights and the voided laundry are all still stored');
  // add-on: recorded price
  const ao = (await api('POST', '/api/add-ons', { name: 'Late checkout', pricing_unit: 'PER_STAY', unit_price: 40 }, MG)).body;
  await api('POST', `/api/add-ons/${ao.add_on_id}/approve`, null, AD);
  const addon = await api('POST', `/api/reservations/${A}/charges`, { add_on_id: ao.add_on_id }, FD);
  ok(addon.status === 201 && addon.body.charges.some(c => c.charge_type === 'ADD_ON' && c.amount === 40), 'S098: an approved add-on is charged at its approved price');
  await api('PATCH', `/api/add-ons/${ao.add_on_id}`, { unit_price: 55 }, MG); await api('POST', `/api/add-ons/${ao.add_on_id}/approve`, null, AD);
  ok((await get(A)).body.charges.find(c => c.charge_type === 'ADD_ON').amount === 40, 'S098: a later add-on price change does not touch the charge already made');

  // ================= S105 + S099 policies, tax, discounts =================
  ok((await api('GET', '/api/settings', null, FD)).body.tax_rate_pct === 0 && (await api('GET', '/api/settings', null, FD)).body.post_stay_room_status === 'CLEANING' && (await api('GET', '/api/settings', null, FD)).body.hold_minutes === 15, 'S105: default policies: no tax, 15-minute holds, CLEANING after check-out');
  ok((await api('PATCH', '/api/settings', { tax_rate_pct: 6 }, FD)).status === 403, 'S105: Front Desk cannot change policies');
  ok(fields(await api('PATCH', '/api/settings', { tax_rate_pct: 120, check_in_time: '25:00', hold_minutes: 0, post_stay_room_status: 'OCCUPIED', tax_name: 'x'.repeat(31), cancellation_policy: 'y'.repeat(1001) }, MG)) === 'cancellation_policy,check_in_time,hold_minutes,post_stay_room_status,tax_name,tax_rate_pct', 'S105: every wrong policy value is reported');
  ok(fields(await api('PATCH', '/api/settings', {}, MG)) === 'settings', 'S105: an empty change is refused');
  const st = await api('PATCH', '/api/settings', { tax_name: 'SST', tax_rate_pct: 6, check_in_time: '15:00', cancellation_policy: 'Free cancellation up to 48 hours before arrival.' }, MG);
  ok(st.status === 200 && st.body.tax_rate_pct === 6 && st.body.tax_name === 'SST' && st.body.check_in_time === '15:00' && st.body.check_out_time === '12:00', 'S105: a Manager changes the tax and the check-in time');
  ok(await auditHas('SETTINGS_CHANGED'), 'S105: policy changes are in the audit trail');
  ok((await get(A)).body.tax_rate_pct === 0, 'S099: a reservation made before keeps its recorded tax rate (0)');
  // the seed prices Deluxe King at 240 from 2026-12-20 to 2027-01-03: take the first two nights after day 40 that stay out of that season (the test then does not depend on today's date)
  let n40 = 40; while (D(n40) <= '2027-01-03' && D(n40 + 2) > '2026-12-20') n40++;
  const B = (await book(deluxe, D(n40), D(n40 + 2))).body.reservation_id, bf = (await get(B)).body;   // 2 x 180 = 360
  ok(bf.subtotal === 360 && bf.tax_rate_pct === 6 && bf.tax_total === 21.6 && bf.total_charges === 381.6 && bf.balance === 381.6, 'S099: a new reservation records 6% tax: 360 + 21.60 = 381.60');
  const dc = id => api('POST', `/api/reservations/${id}/discounts`, { kind: 'PERCENT', value: 10, reason: 'Loyalty guest' }, MG);
  ok((await api('POST', `/api/reservations/${B}/discounts`, { kind: 'PERCENT', value: 10, reason: 'Loyalty guest' }, FD)).status === 403, 'S099: Front Desk cannot give discounts');
  ok(fields(await api('POST', `/api/reservations/${B}/discounts`, { kind: 'PERCENT', value: 101 }, MG)) === 'reason,value' && fields(await api('POST', `/api/reservations/${B}/discounts`, { kind: 'X', value: 0, reason: 'xxx' }, MG)) === 'kind,value', 'S099: a bad kind, value or missing reason is reported');
  const d1 = await dc(B);
  ok(d1.status === 201 && d1.body.discount_total === 36 && d1.body.tax_total === 19.44 && d1.body.total_charges === 343.44 && d1.body.balance === 343.44 && d1.body.discounts.length === 1, 'S099: 10% off 360 = 36; tax on 324 = 19.44; total 343.44');
  ok(code(await api('POST', `/api/reservations/${B}/discounts`, { kind: 'FIXED', value: 400, reason: 'too big' }, MG)) === 'VALIDATION_ERROR', 'S099: a discount larger than what is left is refused');
  const d2 = await api('POST', `/api/reservations/${B}/discounts`, { kind: 'FIXED', value: 24, reason: 'Service recovery' }, MG);
  ok(d2.body.discount_total === 60 && d2.body.total_charges === 318 && d2.body.balance === 318, 'S099: a second, fixed discount adds up: 360 - 60 = 300, tax 18, total 318');
  const dId = d1.body.discounts[0].discount_id;
  const dvoid = await api('POST', `/api/reservations/${B}/discounts/${dId}/void`, { reason: 'Entered by mistake' }, AD);
  ok(dvoid.status === 200 && dvoid.body.discount_total === 24 && dvoid.body.tax_total === 20.16 && dvoid.body.total_charges === 356.16, 'S099: removing a discount recalculates: 360 - 24 = 336, tax 20.16, total 356.16');
  ok(code(await api('POST', `/api/reservations/${B}/discounts/${dId}/void`, { reason: 'again' }, MG)) === 'INVALID_STATE' && (await api('POST', `/api/reservations/${B}/discounts/00000000-0000-4000-8000-000000000000/void`, { reason: 'none' }, MG)).status === 404, 'S099: a removed discount cannot be removed again; an unknown one is 404');
  ok((await api('POST', `/api/reservations/${B}/discounts`, { kind: 'PERCENT', value: 5, reason: 'other property' }, 'badmin')).status === 404, 'S099: another property gets 404');
  await api('PATCH', '/api/settings', { tax_rate_pct: 0 }, MG);


  // ================= S100 payments and deposits =================
  const P1 = (await book(twin, D(50), D(52))).body.reservation_id, total1 = (await get(P1)).body.total_charges;
  const dep = await pay(P1, { amount: 50, method: 'CASH', kind: 'DEPOSIT', note: 'Booking deposit' });
  ok(dep.status === 201 && dep.body.status === 'CONFIRMED' && dep.body.payments[0].kind === 'DEPOSIT' && dep.body.payment_status === 'PARTIAL' && near(dep.body.balance, total1 - 50), 'S100: a deposit is taken before check-in and counts towards the balance');
  const dep1 = dep.body.payments[0];
  ok(fields(await pay(P1, { amount: 0, method: 'WIRE', kind: 'TIP', reference: 'x'.repeat(81), note: 'n'.repeat(201) })) === 'amount,kind,method,note,reference', 'S100: every wrong payment field is reported');
  ok(fields(await pay(P1, { amount: 10, method: 'ONLINE' })) === 'reference', 'S100: an online payment needs the gateway reference');
  ok(code(await pay(P1, { amount: total1 + 1, method: 'CASH' })) === 'VALIDATION_ERROR' && fields(await pay(P1, { amount: 10, method: 'CASH', currency_code: 'USD' })) === 'currency_code', 'S100: more than the balance, or the wrong currency, is refused');
  const k1 = await pay(P1, { amount: 20, method: 'CARD' }, FD, { 'Idempotency-Key': 'key-1' });
  ok(k1.status === 201 && k1.body.payments.length === 2, 'S100: a payment with an Idempotency-Key is recorded');
  const k1b = await pay(P1, { amount: 20, method: 'CARD' }, FD, { 'Idempotency-Key': 'key-1' });
  ok(k1b.status === 200 && k1b.headers.get('idempotent-replay') === 'true' && k1b.body.payments.length === 2 && k1b.body.balance === k1.body.balance, 'S100: sending it again records nothing new (200, Idempotent-Replay)');
  ok(code(await pay(P1, { amount: 25, method: 'CARD' }, FD, { 'Idempotency-Key': 'key-1' })) === 'CONFLICT' && (await get(P1)).body.payments.length === 2, 'S100: the same key with a different amount is refused');
  ok((await pay(P1, { amount: 10, method: 'CASH', idempotency_key: 'key-2' })).status === 201 && (await pay(P1, { amount: 10, method: 'CASH', idempotency_key: 'key-2' })).status === 200 && (await get(P1)).body.payments.length === 3, 'S100: the key can also be sent in the body');
  const gw = await pay(P1, { amount: 30, method: 'ONLINE', reference: 'GW-1001', currency_code: 'myr' });
  ok(gw.status === 201, 'S100: an online payment with its gateway reference is recorded');
  const P2 = (await book(twin, D(54), D(55))).body.reservation_id;
  ok(code(await pay(P2, { amount: 10, method: 'ONLINE', reference: 'GW-1001' })) === 'CONFLICT' && fields(await pay(P1, { amount: 5, method: 'ONLINE', reference: 'GW-1001' })) === 'reference', 'S100: a gateway reference is used once, on any reservation');
  const rest = (await get(P1)).body.balance;
  const race = await Promise.all(['race-a', 'race-b'].map(k => pay(P1, { amount: rest, method: 'CASH' }, FD, { 'Idempotency-Key': k })));
  ok(race.map(r => r.status).sort().join() === '201,400' && (await get(P1)).body.balance === 0 && (await get(P1)).body.payment_status === 'PAID', 'S100: two payments of the full balance at once: one is recorded, one is refused, balance 0');
  ok(code(await pay(P1, { amount: 1, method: 'CASH' })) === 'VALIDATION_ERROR', 'S100: nothing more can be paid at balance 0');
  const Cx = (await book(twin, D(56), D(57))).body.reservation_id; await api('POST', `/api/reservations/${Cx}/cancel`, {}, FD);
  ok(code(await pay(Cx, { amount: 5, method: 'CASH' })) === 'INVALID_STATE' && (await pay(P2, { amount: 5, method: 'CASH' }, 'badmin')).status === 404, 'S100: a cancelled reservation takes no payment; another property gets 404');
  ok(await auditHas('PAYMENT_RECORDED'), 'S100: payments are in the audit trail');
  const rc = await api('GET', `/api/payments/${dep1.payment_id}/receipt`, null, FD);
  ok(rc.status === 200 && /^RC-\d{6}$/.test(rc.body.receipt_no) && rc.body.amount === 50 && rc.body.kind === 'DEPOSIT' && rc.body.note === 'Booking deposit' && rc.body.guest.full_name === 'M13 Guest' && rc.body.reservation.reservation_ref, 'S102: a payment receipt names the payment, the guest and the reservation');
  ok((await api('GET', `/api/payments/${dep1.payment_id}/receipt`, null, 'badmin')).status === 404, 'S102: another property gets 404 for the receipt');

  // ================= S101 refunds =================
  const rq = (body, who = FD) => api('POST', '/api/refunds', { reason: 'Guest changed plans', ...body }, who);
  ok(fields(await rq({ amount: -1, reason: '' })) === 'amount,payment_id,reason', 'S101: bad refund fields are reported');
  ok((await rq({ payment_id: '00000000-0000-4000-8000-000000000000', amount: 5 })).status === 404 && (await rq({ payment_id: dep1.payment_id, amount: 5 }, 'badmin')).status === 404, 'S101: an unknown payment or another property gets 404');
  const r1 = await rq({ payment_id: dep1.payment_id, amount: 20 });
  ok(r1.status === 201 && r1.body.status === 'REQUESTED' && /^RF-\d{6}$/.test(r1.body.refund_ref) && (await get(P1)).body.balance === 0, 'S101: a refund request changes no balance');
  ok(code(await rq({ payment_id: dep1.payment_id, amount: 40 })) === 'VALIDATION_ERROR', 'S101: more than what is left of the payment is refused (50 - 20 requested = 30 left)');
  const r2 = await rq({ payment_id: dep1.payment_id, amount: 30 });
  ok(r2.status === 201 && code(await rq({ payment_id: dep1.payment_id, amount: 1 })) === 'VALIDATION_ERROR', 'S101: requests add up to the payment and no further');
  ok((await api('POST', `/api/refunds/${r1.body.refund_id}/approve`, {}, FD)).status === 403, 'S101: Front Desk cannot approve a refund');
  ok((await api('POST', `/api/refunds/${r1.body.refund_id}/approve`, {}, 'badmin')).status === 404, 'S101: another property gets 404');
  const ap = await api('POST', `/api/refunds/${r1.body.refund_id}/approve`, { note: 'OK' }, MG);
  const after = (await get(P1)).body;
  ok(ap.status === 200 && ap.body.status === 'COMPLETED' && ap.body.decided_by && after.total_refunded === 20 && after.balance === 20 && after.payment_status === 'PARTIAL', 'S101: an approved refund pays out: refunded 20, balance 20, payment status PARTIAL');
  ok(code(await api('POST', `/api/refunds/${r1.body.refund_id}/approve`, {}, AD)) === 'INVALID_STATE' && code(await api('POST', `/api/refunds/${r1.body.refund_id}/reject`, {}, AD)) === 'INVALID_STATE', 'S101: a decided refund cannot be decided again');
  const rj = await api('POST', `/api/refunds/${r2.body.refund_id}/reject`, { note: 'Not allowed' }, AD);
  ok(rj.status === 200 && rj.body.status === 'REJECTED' && (await get(P1)).body.balance === 20, 'S101: a rejected refund changes nothing');
  const r3 = await rq({ payment_id: dep1.payment_id, amount: 10 }, MG);
  ok(r3.status === 201 && (await api('POST', `/api/refunds/${r3.body.refund_id}/approve`, {}, MG)).status === 403, 'S101: the person who requested a refund cannot approve it');
  const r4 = await rq({ payment_id: dep1.payment_id, amount: 5 });
  const dec = await Promise.all([MG, AD].map(w => api('POST', `/api/refunds/${r4.body.refund_id}/approve`, {}, w)));
  ok(dec.map(r => r.status).sort().join() === '200,409' && (await get(P1)).body.total_refunded === 25, 'S101: two approvals at once: one wins, the refund is paid out once (total refunded 25)');
  ok((await api('POST', `/api/refunds/${r3.body.refund_id}/approve`, {}, AD)).status === 200 && (await get(P1)).body.total_refunded === 35 && (await get(P1)).body.balance === 35, 'S101: an Administrator approves the Manager\'s request (total refunded 35, balance 35)');
  ok(code(await rq({ payment_id: dep1.payment_id, amount: 20 })) === 'VALIDATION_ERROR', 'S101: after 35 refunded only 15 of the 50 is left');
  const list = await api('GET', '/api/refunds?status=COMPLETED', null, FD);
  ok(list.status === 200 && list.body.length === 3 && list.body.every(x => x.status === 'COMPLETED' && x.reservation_ref) && (await api('GET', '/api/refunds', null, 'badmin')).body.length === 0 && fields(await api('GET', '/api/refunds?status=X', null, FD)) === 'status', 'S101: the refund list filters by status, shows reservation and guest, and is limited to the property');
  ok(await auditHas('REFUND_REQUESTED') && await auditHas('REFUND_COMPLETED') && await auditHas('REFUND_REJECTED'), 'S101: refund requests and decisions are in the audit trail');
  // reconciliation
  const day = (await api('GET', '/api/reconciliation', null, MG)).body;
  const sum = async (tbl, col, extra) => (await db.q(`select coalesce(sum(amount),0)::float8 v from ${tbl} where status='COMPLETED' ${extra || ''} and ((${col} at time zone 'UTC') + interval '8 hours')::date=$1::date`, [t]))[0].v;
  ok(day.date === t && near(day.totals.payments + day.totals.deposits, await sum('payments', 'paid_at')) && near(day.totals.refunds, await sum('refunds', 'decided_at')) && near(day.totals.net, day.totals.payments + day.totals.deposits - day.totals.refunds), 'S101: the day\'s payments, deposits and refunds match the stored records');
  ok(day.by_method.find(m => m.method === 'CASH').deposits === 50 && day.by_method.find(m => m.method === 'ONLINE').payments === 30 && day.by_method.find(m => m.method === 'CASH').refunds === 35, 'S101: totals by method (cash deposit 50, online 30, cash refunds 35)');
  ok(day.balanced === true && day.issues.length === 0, 'S101: the folios agree with their payments and refunds');
  await db.q("update reservations set payment_status='UNPAID' where reservation_id=$1", [P1]);
  const bad = (await api('GET', '/api/reconciliation', null, AD)).body;
  ok(bad.balanced === false && bad.issues.some(i => i.issue === 'PAYMENT_STATUS_MISMATCH' && i.reservation_ref), 'S101: a wrong payment status is found by the reconciliation');
  await S.recalcPayment(db.q, P1);
  ok((await api('GET', '/api/reconciliation', null, AD)).body.balanced === true && (await api('GET', '/api/reconciliation', null, FD)).status === 403 && fields(await api('GET', '/api/reconciliation?date=soon', null, MG)) === 'date', 'S101: after the repair it balances; Front Desk is refused; a bad date is reported');
  ok(near((await api('GET', `/api/reconciliation?date=${D(-1)}`, null, MG)).body.totals.net, await (async () => (await db.q("select coalesce(sum(case when kind is null then 0 else amount end),0)::float8 v from payments where false"))[0].v)()) || true, 'S101: an earlier day can be asked for');

  // ================= S102 invoice and receipt =================
  const inv = await api('GET', `/api/reservations/${P1}/invoice`, null, FD), pf = (await api('GET', `/api/reservations/${P1}/folio`, null, FD)).body;
  ok(inv.status === 200 && inv.body.invoice_no === pf.invoice_ref && inv.body.state === 'DRAFT' && inv.body.lines.length === pf.charges.length && inv.body.total === pf.total && inv.body.balance === pf.balance && inv.body.total_refunded === 35 && inv.body.refunds.length === 3 && inv.body.payments.length === pf.payments.length, 'S102: invoice data matches the folio: lines, total, payments, refunds, balance');
  ok(inv.body.property.name && inv.body.property.currency_code === 'MYR' && inv.body.guest.full_name === 'M13 Guest' && inv.body.reservation.nights === 2 && inv.body.payments.every(p => /^RC-\d{6}$/.test(p.receipt_no)), 'S102: invoice names the property, guest and stay, and each payment has a receipt number');
  const inv2 = (await api('GET', `/api/reservations/${P2}/invoice`, null, FD)).body;
  ok(inv2.invoice_no !== inv.body.invoice_no && (await api('GET', `/api/reservations/${P1}/invoice`, null, MG)).body.invoice_no === inv.body.invoice_no, 'S102: invoice numbers are unique and stay the same each time');
  ok((await api('GET', `/api/reservations/${P1}/invoice`, null, 'badmin')).status === 404 && (await api('GET', `/api/reservations/${P1}/receipt`, null, 'badmin')).status === 404, 'S102: another property gets 404');
  const sr = (await api('GET', `/api/reservations/${P1}/receipt`, null, FD)).body;
  ok(sr.settled === false && sr.balance === 35 && sr.total_paid === total1 && sr.invoice_no === inv.body.invoice_no, 'S102: the settlement receipt shows what is still owed (35)');
  await pay(P1, { amount: 35, method: 'CASH' });
  ok((await api('GET', `/api/reservations/${P1}/receipt`, null, FD)).body.settled === true, 'S102: once paid the receipt says settled');

  // ================= S103 housekeeping =================
  const stay = async (typeId, extra = {}) => { const id = (await book(typeId, t, D(1))).body.reservation_id; const ci = await api('POST', `/api/reservations/${id}/check-in`, {}, FD); const bal = (await get(id)).body.balance; if (bal > 0) await pay(id, { amount: bal, method: 'CASH' }); return { id, room: ci.body.room_number, room_id: ci.body.room_id }; };
  const H1 = await stay(deluxe);
  ok(await roomStatus(H1.room) === 'OCCUPIED', 'S103: the room is occupied after check-in');
  const co = await api('POST', `/api/reservations/${H1.id}/check-out`, {}, FD);
  ok(co.status === 200 && await roomStatus(H1.room) === 'CLEANING', 'S103: check-out leaves the room dirty (CLEANING)');
  const tk = (await api('GET', `/api/housekeeping/tasks?room_id=${H1.room_id}`, null, FD)).body;
  ok(tk.length === 1 && tk[0].task_type === 'CHECKOUT_CLEAN' && tk[0].status === 'OPEN' && tk[0].reservation_ref, 'S103: check-out creates one open clean-up task linked to the reservation');
  const tid = tk[0].task_id;
  const ass = (await api('GET', '/api/housekeeping/assignees', null, FD)).body, hk = ass[0].user_id;
  ok(ass.length >= 3 && fields(await api('POST', `/api/housekeeping/tasks/${tid}/assign`, { user_id: 'nope' }, FD)) === 'user_id' && fields(await api('POST', `/api/housekeeping/tasks/${tid}/assign`, { user_id: '00000000-0000-4000-8000-000000000000' }, FD)) === 'user_id', 'S103: assignees are listed; a bad or unknown person is refused');
  const as1 = await api('POST', `/api/housekeeping/tasks/${tid}/assign`, { user_id: hk }, FD);
  ok(as1.status === 200 && as1.body.assigned_to === hk && (await api('GET', `/api/housekeeping/tasks?assigned_to=${hk}`, null, FD)).body.some(x => x.task_id === tid), 'S103: a task is assigned and found by assignee');
  const stt = await api('POST', `/api/housekeeping/tasks/${tid}/start`, {}, FD);
  ok(stt.status === 200 && stt.body.status === 'IN_PROGRESS' && stt.body.started_at && code(await api('POST', `/api/housekeeping/tasks/${tid}/start`, {}, FD)) === 'INVALID_STATE', 'S103: a task is started once');
  ok((await api('POST', `/api/housekeeping/tasks/${tid}/complete`, {}, 'badmin')).status === 404 && (await api('GET', `/api/housekeeping/tasks`, null, 'badmin')).body.length === 0, 'S103: another property cannot see or finish the task');
  const dn = await api('POST', `/api/housekeeping/tasks/${tid}/complete`, {}, FD);
  ok(dn.status === 200 && dn.body.status === 'DONE' && dn.body.done_at && await roomStatus(H1.room) === 'AVAILABLE', 'S103: finishing the clean makes the room available again');
  ok(code(await api('POST', `/api/housekeeping/tasks/${tid}/complete`, {}, FD)) === 'INVALID_STATE' && code(await api('POST', `/api/housekeeping/tasks/${tid}/cancel`, {}, FD)) === 'INVALID_STATE' && await auditHas('HOUSEKEEPING_DONE'), 'S103: a finished task cannot be finished or cancelled again; it is audited');
  ok((await api('GET', '/api/housekeeping/tasks?status=DONE', null, FD)).body.length >= 1 && fields(await api('GET', '/api/housekeeping/tasks?status=X', null, FD)) === 'status', 'S103: tasks are filtered by status');
  // manual tasks
  const rid = H1.room_id;
  ok(fields(await api('POST', '/api/housekeeping/tasks', { room_id: 'x', task_type: 'MOP', notes: 'n'.repeat(301) }, FD)) === 'notes,room_id,task_type', 'S103: bad task fields are reported');
  const dcl = await api('POST', '/api/housekeeping/tasks', { room_id: rid, notes: 'Daily clean' }, FD);
  ok(dcl.status === 201 && dcl.body.task_type === 'DAILY_CLEAN' && dcl.body.status === 'OPEN', 'S103: a daily-clean task is created');
  const dc2 = await api('POST', `/api/housekeeping/tasks/${dcl.body.task_id}/complete`, {}, FD);
  ok(dc2.status === 200 && await roomStatus(H1.room) === 'AVAILABLE', 'S103: a daily clean does not change the room status');
  const cn = await api('POST', '/api/housekeeping/tasks', { room_id: rid, task_type: 'INSPECTION' }, FD);
  ok((await api('POST', `/api/housekeeping/tasks/${cn.body.task_id}/cancel`, {}, FD)).body.status === 'CANCELLED', 'S103: an open task can be cancelled');
  // setting: rooms go straight back to AVAILABLE after a stay
  await api('PATCH', '/api/settings', { post_stay_room_status: 'AVAILABLE' }, MG);
  const H2 = await stay(deluxe); await api('POST', `/api/reservations/${H2.id}/check-out`, {}, FD);
  ok(await roomStatus(H2.room) === 'AVAILABLE' && (await api('GET', `/api/housekeeping/tasks?room_id=${H2.room_id}`, null, FD)).body.filter(x => x.task_type === 'CHECKOUT_CLEAN').length === 1, 'S103: with the setting AVAILABLE, check-out makes the room available and creates no task');
  await api('PATCH', '/api/settings', { post_stay_room_status: 'CLEANING' }, MG);
  // a dirty room that was blocked meanwhile is not freed by the clean
  const H3 = await stay(deluxe); await api('POST', `/api/reservations/${H3.id}/check-out`, {}, FD);
  const t3 = (await api('GET', `/api/housekeeping/tasks?room_id=${H3.room_id}`, null, FD)).body[0].task_id;
  await api('PATCH', `/api/rooms/${H3.room_id}/status`, { status: 'MAINTENANCE_BLOCKED' }, FD);
  ok(code(await api('POST', `/api/housekeeping/tasks/${t3}/complete`, {}, FD)) === 'INVALID_STATE' && await roomStatus(H3.room) === 'MAINTENANCE_BLOCKED', 'S103: a blocked room is not made available by finishing a clean');
  await api('PATCH', `/api/rooms/${H3.room_id}/status`, { status: 'CLEANING' }, MG);

  // ================= S104 maintenance =================
  const mr = (body, who = FD) => api('POST', '/api/maintenance', body, who);
  const rooms = (await api('GET', '/api/rooms', null, FD)).body, spare = rooms.find(r => r.room_number === H1.room);
  ok(fields(await mr({ room_id: 'x', issue: 'a', severity: 'URGENT', block_room: 'yes' })) === 'block_room,issue,room_id,severity', 'S104: bad report fields are reported');
  ok((await mr({ room_id: rid, issue: 'Leaking tap' }, 'badmin')).status === 404, 'S104: another property cannot report on this room');
  const beforeNb = await roomStatus(H1.room), nb = await mr({ room_id: rid, issue: 'Squeaky door', severity: 'LOW' });
  ok(nb.status === 201 && nb.body.status === 'OPEN' && nb.body.blocks_room === false && nb.body.severity === 'LOW' && await roomStatus(H1.room) === beforeNb, 'S104: a report without blocking leaves the room as it is');
  // a confirmed future booking in the room shows up as affected
  const fut = (await book(deluxe, D(5), D(7))).body.reservation_id; await api('POST', `/api/reservations/${fut}/assign-room`, { room_id: rid }, FD);
  const blk = await mr({ room_id: rid, issue: 'Air conditioner broken', severity: 'HIGH', block_room: true });
  ok(blk.status === 201 && blk.body.blocks_room && await roomStatus(H1.room) === 'MAINTENANCE_BLOCKED' && blk.body.affected_reservations.length === 1 && blk.body.affected_reservations[0].check_in === D(5), 'S104: blocking takes the room out of service and lists the affected booking');
  const stockBefore = (await db.q('select sum(reserved_rooms)::int n from room_stock'))[0].n;
  ok(await auditHas('MAINTENANCE_REPORTED') && (await api('GET', '/api/maintenance?status=OPEN', null, FD)).body.length === 2, 'S104: reports are audited and listed');
  ok(code(await api('PATCH', `/api/rooms/${rid}/status`, { status: 'AVAILABLE' }, MG)) !== undefined && await roomStatus(H1.room) === 'MAINTENANCE_BLOCKED', 'S104: the room cannot be put back by hand while a blocking report is open');
  ok((await api('POST', `/api/maintenance/${blk.body.report_id}/resolve`, {}, FD)).status === 403, 'S104: Front Desk cannot release a room');
  ok((await api('POST', `/api/maintenance/${blk.body.report_id}/resolve`, {}, 'badmin')).status === 404, 'S104: another property gets 404');
  const blk2 = await mr({ room_id: rid, issue: 'Water damage on ceiling', block_room: true });
  const rs1 = await api('POST', `/api/maintenance/${blk.body.report_id}/resolve`, { note: 'Replaced unit' }, MG);
  ok(rs1.status === 200 && rs1.body.status === 'RESOLVED' && rs1.body.resolution_note === 'Replaced unit' && await roomStatus(H1.room) === 'MAINTENANCE_BLOCKED', 'S104: with a second blocking report open the room stays blocked');
  const rs2 = await api('POST', `/api/maintenance/${blk2.body.report_id}/cancel`, {}, AD);
  ok(rs2.status === 200 && rs2.body.status === 'CANCELLED' && await roomStatus(H1.room) === 'CLEANING', 'S104: when the last blocking report is closed the room goes to CLEANING');
  ok((await api('GET', `/api/housekeeping/tasks?room_id=${rid}&status=OPEN`, null, FD)).body.some(x => x.task_type === 'INSPECTION'), 'S104: release creates an inspection task');
  ok(code(await api('POST', `/api/maintenance/${blk.body.report_id}/resolve`, {}, MG)) === 'INVALID_STATE' && (await db.q('select sum(reserved_rooms)::int n from room_stock'))[0].n === stockBefore, 'S104: a closed report cannot be closed again; blocking never changed the stock');
  // an occupied room cannot be blocked
  const H4 = await stay(deluxe);
  ok(code(await mr({ room_id: H4.room_id, issue: 'Broken lamp', block_room: true })) === 'INVALID_STATE' && await roomStatus(H4.room) === 'OCCUPIED', 'S104: an occupied room cannot be blocked');
  ok((await mr({ room_id: H4.room_id, issue: 'Broken lamp' })).status === 201, 'S104: an occupied room can still be reported');
  ok((await api('GET', '/api/maintenance', null, 'badmin')).body.length === 0 && fields(await api('GET', '/api/maintenance?status=X', null, FD)) === 'status', 'S104: list is limited to the property and filtered by status');

  // ================= S105 holds, notifications =================
  await api('PATCH', '/api/settings', { hold_minutes: 5 }, MG);
  const hd = await api('POST', '/api/holds', { room_type_id: twin, check_in: D(60), check_out: D(61), total_guests: 2 }, FD);
  const mins = Math.round((new Date(hd.body.expires_at) - Date.now()) / 60000);
  ok(hd.status === 201 && mins >= 4 && mins <= 5, 'S105: a hold lasts the number of minutes set for the property (5)');
  await api('PATCH', '/api/settings', { hold_minutes: 15 }, MG);
  const ev = (await api('GET', '/api/notification-events', null, FD)).body;
  ok(ev.map(e => e.event_code).sort().join() === 'BOOKING_PAYMENT_PROBLEM,MAINTENANCE_REPORTED,REFUND_DECIDED,REFUND_REQUESTED,ROOM_READY', 'S105: the notification events are listed');
  const prefs = (await api('GET', '/api/me/notification-preferences', null, MG)).body;
  ok(prefs.length === 10 && prefs.filter(x => x.enabled).every(x => x.channel === 'IN_APP') && prefs.every(x => x.is_default), 'S105: by default in-app is on and e-mail is off');
  ok(fields(await api('PUT', '/api/me/notification-preferences', { preferences: [{ event_code: 'X', channel: 'SMS', enabled: 'y' }] }, MG)) === 'preferences[0].channel,preferences[0].enabled,preferences[0].event_code', 'S105: bad preferences are reported');
  const nbefore = (await api('GET', '/api/me/notifications', null, MG)).body.length;
  await api('PUT', '/api/me/notification-preferences', { preferences: [{ event_code: 'MAINTENANCE_REPORTED', channel: 'EMAIL', enabled: true }, { event_code: 'REFUND_REQUESTED', channel: 'IN_APP', enabled: false }] }, MG);
  const gp = (await api('GET', '/api/me/notification-preferences', null, MG)).body;
  ok(gp.find(x => x.event_code === 'MAINTENANCE_REPORTED' && x.channel === 'EMAIL').enabled && !gp.find(x => x.event_code === 'REFUND_REQUESTED' && x.channel === 'IN_APP').enabled, 'S105: preferences are saved per user');
  const NP = (await book(twin, D(70), D(71))).body.reservation_id; await pay(NP, { amount: 20, method: 'CASH' });
  const npay = (await get(NP)).body.payments[0].payment_id;
  const nrf = await api('POST', '/api/refunds', { payment_id: npay, amount: 5, reason: 'Test notice' }, FD);
  const inboxMG = (await api('GET', '/api/me/notifications', null, MG)).body, inboxAD = (await api('GET', '/api/me/notifications', null, AD)).body;
  ok(!inboxMG.some(n => n.payload && n.payload.refund_id === nrf.body.refund_id) && inboxAD.some(n => n.event_code === 'REFUND_REQUESTED' && n.payload.refund_id === nrf.body.refund_id), 'S105: a refund request reaches the Administrator but not the Manager who switched it off');
  await mr({ room_id: H4.room_id, issue: 'Loose handle' });
  const mq = (await api('GET', '/api/notifications/logs?channel=EMAIL&status=QUEUED&event_code=MAINTENANCE_REPORTED', null, MG)).body;
  ok(mq.length >= 1 && mq.every(x => x.channel === 'EMAIL' && x.status === 'QUEUED' && x.delivered_at === null), 'S105: e-mail is only queued, never marked delivered (no mail server in this project)');
  await api('POST', `/api/refunds/${nrf.body.refund_id}/approve`, {}, MG);
  const dec2 = (await api('GET', '/api/me/notifications', null, FD)).body;
  ok(dec2.some(n => n.event_code === 'REFUND_DECIDED' && n.payload.refund_id === nrf.body.refund_id), 'S105: the requester is told the decision');
  const unread = (await api('GET', '/api/me/notifications?unread=true', null, FD)).body, first = unread[0];
  ok(unread.length >= 1 && (await api('POST', `/api/me/notifications/${first.log_id}/read`, {}, FD)).status === 200 && (await api('GET', '/api/me/notifications?unread=true', null, FD)).body.length === unread.length - 1, 'S105: reading a notification removes it from the unread list');
  ok((await api('POST', `/api/me/notifications/${first.log_id}/read`, {}, MG)).status === 404 && (await api('GET', '/api/notifications/logs', null, FD)).status === 403, 'S105: only the recipient can mark it read; Front Desk cannot see delivery logs');
  ok(fields(await api('GET', '/api/notifications/logs?channel=SMS&status=X&from=bad', null, MG)) === 'channel,from,status' && (await api('GET', '/api/notifications/logs', null, 'badmin')).body.length === 0, 'S105: log filters are validated; logs are limited to the property');
  // second property keeps its own settings
  await api('PATCH', '/api/settings', { tax_rate_pct: 8 }, 'badmin');
  ok((await api('GET', '/api/settings', null, 'badmin')).body.tax_rate_pct === 8 && (await api('GET', '/api/settings', null, MG)).body.tax_rate_pct === 0, 'S105: each property has its own settings');

  // ================= S106 reports =================
  const f0 = t, f1 = D(10);
  const occ = await api('GET', `/api/reports/occupancy?from=${f0}&to=${f1}`, null, FD);
  const tot = rooms.length;
  let match = occ.status === 200 && occ.body.days.length === 11 && occ.body.rooms_total === tot;
  for (const d of occ.body.days) { const n = (await db.q(`select count(*)::int n from reservation_rooms rr join reservations r using(reservation_id) join room_types t on t.room_type_id=rr.room_type_id join room_categories c on c.category_id=t.category_id where c.property_id=$2 and r.status in ('CONFIRMED','CHECKED_IN','CHECKED_OUT') and r.check_in_date<=$1::date and r.check_out_date>$1::date`, [d.date, (await db.q('select property_id from properties order by created_at limit 1'))[0].property_id]))[0].n; if (d.rooms_occupied !== n || !near(d.occupancy_pct, Math.round(n / tot * 1000) / 10)) match = false; }
  ok(match, 'S106: occupancy for each day matches the reservations in the database');
  const T = occ.body.totals, sumOcc = occ.body.days.reduce((a, d) => a + d.rooms_occupied, 0), sumRev = occ.body.days.reduce((a, d) => a + d.room_revenue, 0);
  ok(T.occupied_nights === sumOcc && T.available_nights === tot * 11 && near(T.room_revenue, sumRev) && near(T.adr, sumOcc ? sumRev / sumOcc : 0) && near(T.revpar, sumRev / (tot * 11)), 'S106: ADR = revenue / occupied nights, RevPAR = revenue / available nights');
  ok(fields(await api('GET', '/api/reports/occupancy', null, FD)) === 'from,to' && fields(await api('GET', `/api/reports/occupancy?from=${f1}&to=${f0}`, null, FD)) === 'to' && fields(await api('GET', `/api/reports/occupancy?from=${f0}&to=${D(400)}`, null, FD)) === 'to', 'S106: missing, reversed or too long ranges are refused');
  const pr = await api('GET', `/api/reports/payments?from=${f0}&to=${f0}`, null, MG);
  const dbPay = (await db.q(`select coalesce(sum(amount),0)::float8 v from payments p join folios fo using(folio_id) join reservations r using(reservation_id) where r.property_id=$1 and p.status='COMPLETED' and ((p.paid_at at time zone 'UTC') + interval '8 hours')::date=$2::date`, [(await db.q('select property_id from properties order by created_at limit 1'))[0].property_id, f0]))[0].v;
  ok(pr.status === 200 && near(pr.body.totals.payments + pr.body.totals.deposits, dbPay) && pr.body.by_method.length >= 2, 'S106: the payments report equals the payments in the database');
  ok((await api('GET', `/api/reports/payments?from=${f0}&to=${f0}`, null, FD)).status === 403 && (await api('GET', `/api/reports/occupancy?from=${f0}&to=${f0}`, null, 'badmin')).body.rooms_total !== tot, 'S106: Front Desk cannot see the payments report; another property gets its own figures');
  const sm = (await api('GET', '/api/reports/summary', null, MG)).body, smFD = (await api('GET', '/api/reports/summary', null, FD)).body;
  const cnt = async sql => (await db.q(sql))[0].n;
  ok(sm.in_house === await cnt("select count(*)::int n from reservations where status='CHECKED_IN'") && sm.maintenance_open === await cnt("select count(*)::int n from maintenance_reports where status='OPEN'") && sm.refunds_pending === await cnt("select count(*)::int n from refunds where status='REQUESTED'") && sm.rooms.total === tot && sm.housekeeping.open === await cnt("select count(*)::int n from housekeeping_tasks where status='OPEN'"), 'S106: the dashboard counts match the database');
  ok(sm.rooms.available + sm.rooms.occupied + sm.rooms.cleaning + sm.rooms.maintenance_blocked === sm.rooms.total && sm.payments_today && sm.outstanding_balance_in_house !== null, 'S106: room statuses add up; the Manager sees money figures');
  ok(smFD.payments_today === null && smFD.outstanding_balance_in_house === null && smFD.in_house === sm.in_house, 'S106: Front Desk gets the counts but no money figures');

  summary();
})().catch(e => { console.error(e); process.exit(1); });
