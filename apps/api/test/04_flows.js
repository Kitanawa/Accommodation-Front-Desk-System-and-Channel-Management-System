// Business flows still work after the S054/S055 changes: pricing, overbooking, folio, check-in/out, rates, audit.
const { ok, summary, boot, api, tok, DEMO } = require('./helpers');
const S = require('../service');
(async () => {
  const server = await boot(); const mgr = 'manager', fd = 'frontdesk', admin = 'admin';
  // ---- login / roles
  ok((await api('POST', '/api/login', { email: DEMO.admin.email, password: 'wrong-password-1' })).status === 401, 'wrong password is rejected');
  ok(tok.admin && tok.manager && tok.frontdesk, 'three roles can sign in');
  ok((await api('GET', '/api/reservations')).status === 401, 'API needs a session');
  ok((await api('GET', '/api/audit', null, 'frontdesk')).status === 403, 'Front Desk cannot read audit');
  // ---- availability and pricing
  const t = S.today(), from = S.addDays(t, 30), to = S.addDays(from, 2);   // 30 days ahead: weekday depends on date
  let av = (await api('GET', `/api/availability?from=${from}&to=${to}&guests=2`, null, 'frontdesk')).body;
  const std = av.find(x => x.name === 'Standard Twin');
  ok(std.rooms_left === 6 && std.bookable, 'availability: 6 Standard rooms left');
  const expect = S.nightsList(from, to).map(d => [5, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) ? 150 : 120).reduce((a, b) => a + b);
  ok(std.total === expect, `price follows rate rules (Fri/Sat 150, else 120): ${std.total}`);
  const suite = (await api('GET', `/api/availability?from=${from}&to=${S.addDays(from, 1)}&guests=2`, null, 'frontdesk')).body.find(x => x.name === 'Family Suite');
  ok(!suite.bookable && suite.reasons.some(r => r.includes('Minimum 2')), 'minimum nights is enforced');
  const deluxe5 = (await api('GET', `/api/availability?from=${from}&to=${to}&guests=5`, null, 'frontdesk')).body.find(x => x.name === 'Deluxe King');
  ok(!deluxe5.bookable && deluxe5.reasons.some(r => r.includes('Max 3')), 'max guests is enforced');
  ok((await api('GET', `/api/availability?from=${S.addDays(t, -3)}&to=${t}&guests=1`, null, 'frontdesk')).status === 400, 'past dates are rejected');
  // ---- create reservation
  const mk = (extra = {}) => api('POST', '/api/reservations', { guest: { full_name: 'Test Guest', phone: '012' }, room_type_id: std.room_type_id, check_in: from, check_out: to, total_guests: 2, source_id: 2, ...extra }, 'frontdesk');
  const first = await mk();
  ok(first.status === 201 && first.body.reservation_ref, 'Front Desk creates a reservation');
  let d = (await api('GET', `/api/reservations/${first.body.reservation_id}`, null, 'frontdesk')).body;
  ok(d.charges.length === 2 && d.total_charges === expect && d.payment_status === 'UNPAID' && d.status === 'CONFIRMED', 'folio has one ROOM charge per night, UNPAID');
  av = (await api('GET', `/api/availability?from=${from}&to=${to}&guests=2`, null, 'frontdesk')).body;
  ok(av.find(x => x.name === 'Standard Twin').rooms_left === 5, 'inventory drops to 5');
  // ---- overbooking
  for (let i = 0; i < 5; i++) await mk();
  const over = await mk();
  ok(over.status === 409 && /sold out/i.test(over.body.error.message), 'the 7th Standard reservation is refused (no overbooking)');
  ok((await api('GET', `/api/availability?from=${from}&to=${to}&guests=2`, null, 'frontdesk')).body.find(x => x.name === 'Standard Twin').rooms_left === 0, 'inventory shows 0 left');
  // ---- cancel releases stock
  const cx = await api('POST', `/api/reservations/${first.body.reservation_id}/cancel`, null, 'frontdesk');
  ok(cx.status === 200 && cx.body.status === 'CANCELLED', 'cancel works');
  ok((await mk()).status === 201, 'cancelled room is bookable again');
  ok((await api('POST', `/api/reservations/${first.body.reservation_id}/cancel`, null, 'frontdesk')).status === 409, 'cannot cancel twice');
  // ---- payments, check-in, check-out (use the seeded arrival today: Guest One)
  const arr = (await api('GET', '/api/dashboard', null, 'frontdesk')).body;
  ok(arr.arrivals.length === 1 && arr.arrivals[0].full_name === 'Guest One', 'dashboard lists today\'s arrival');
  const id = arr.arrivals[0].reservation_id;
  ok((await api('POST', `/api/reservations/${id}/payments`, { amount: 0, method: 'CASH' }, 'frontdesk')).status === 400, 'zero payment rejected');
  let g = (await api('GET', `/api/reservations/${id}`, null, 'frontdesk')).body;
  let p = await api('POST', `/api/reservations/${id}/payments`, { amount: 100, method: 'CARD' }, 'frontdesk');
  ok(p.body.payment_status === 'PARTIAL', 'part payment sets PARTIAL');
  ok((await api('POST', `/api/reservations/${id}/payments`, { amount: g.balance, method: 'CASH' }, 'frontdesk')).status === 400, 'overpayment rejected');
  const ci = await api('POST', `/api/reservations/${id}/check-in`, null, 'frontdesk');
  ok(ci.status === 200 && ci.body.status === 'CHECKED_IN' && ci.body.room_number, `check-in auto-assigns room ${ci.body.room_number}`);
  ok((await api('GET', '/api/rooms', null, 'frontdesk')).body.find(r => r.room_number === ci.body.room_number).status === 'OCCUPIED', 'room becomes OCCUPIED');
  const co1 = await api('POST', `/api/reservations/${id}/check-out`, null, 'frontdesk');
  ok(co1.status === 409 && /balance/i.test(co1.body.error.message), 'check-out blocked while a balance is outstanding');
  const ch = await api('POST', `/api/reservations/${id}/charges`, { description: 'Minibar', quantity: 2, unit_price: 12.5 }, 'frontdesk');
  ok(ch.body.total_charges === g.total_charges + 25, 'additional charge posted to folio');
  g = ch.body;
  const pay = await api('POST', `/api/reservations/${id}/payments`, { amount: g.balance, method: 'CASH' }, 'frontdesk');
  ok(pay.body.payment_status === 'PAID' && pay.body.balance === 0, 'full payment sets PAID');
  const co = await api('POST', `/api/reservations/${id}/check-out`, null, 'frontdesk');
  ok(co.status === 200 && co.body.status === 'CHECKED_OUT', 'check-out works after payment');
  ok((await api('GET', '/api/rooms', null, 'frontdesk')).body.find(r => r.room_number === ci.body.room_number).status === 'CLEANING', 'room becomes CLEANING');
  // ---- rates and approvals (SRS 4 matrix)
  const rate = { room_type_id: std.room_type_id, rule_type: 'DATE_RANGE', rate_amount: 99, date_from: from, date_to: to, priority: 5 };
  ok((await api('POST', '/api/rates', rate, 'frontdesk')).status === 403, 'Front Desk cannot create rates');
  ok((await api('POST', '/api/rates', { ...rate, date_from: null }, 'manager')).status === 400, 'rate fields must match the rule type');
  const nr = await api('POST', '/api/rates', rate, 'manager');
  ok(nr.status === 201 && nr.body.approval_status === 'PENDING', 'Manager creates a PENDING rate');
  ok(!(await api('GET', '/api/rates', null, 'frontdesk')).body.some(r => r.approval_status === 'PENDING'), 'Front Desk sees approved rates only');
  const price0 = (await api('GET', `/api/availability?from=${from}&to=${to}&guests=2`, null, 'frontdesk')).body.find(x => x.name === 'Standard Twin').total;
  ok(price0 === expect, 'a PENDING rate does not change prices');
  ok((await api('POST', `/api/rates/${nr.body.rate_rule_id}/approve`, null, 'manager')).status === 403, 'Manager cannot approve (Configurable, off by default)');
  ok((await api('POST', `/api/rates/${nr.body.rate_rule_id}/approve`, null, 'admin')).status === 200, 'Administrator approves');
  const price1 = (await api('GET', `/api/availability?from=${from}&to=${to}&guests=2`, null, 'frontdesk')).body.find(x => x.name === 'Standard Twin').total;
  ok(price1 === 198, `approved rate now applies (2 nights x 99 = ${price1})`);
  const base2 = await api('POST', '/api/rates', { room_type_id: std.room_type_id, rule_type: 'BASE', rate_amount: 130 }, 'manager');
  ok((await api('POST', `/api/rates/${base2.body.rate_rule_id}/approve`, null, 'admin')).status === 409, 'a second approved Base Rate is refused');
  // ---- audit
  const au = (await api('GET', '/api/audit', null, 'manager')).body.map(a => a.action);
  ok(['RESERVATION_CREATED', 'CHECKED_IN', 'PAYMENT_RECORDED', 'RATE_APPROVED', 'RESERVATION_CANCELLED'].every(a => au.includes(a)), 'audit records the key actions');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
