// The contract promises: a user only ever sees their own property, and another property's records look like they do not exist (404).
const { ok, summary, boot, api, tok, DEMO } = require('./helpers');
const { addSecondProperty, SECOND } = require('../seed');
const { hashPassword } = require('../password');
const S = require('../service');

(async () => {
  await boot();
  const db = await require('../db').connect();
  const p2 = await addSecondProperty(db);
  await db.q("insert into users(property_id,role_id,full_name,email,password_hash,can_approve_rates) values($1,1,'Second Admin','admin.b@fds.test',$2,true)", [p2.property_id, await hashPassword('Cedar-Demo-2026')]);
  tok.b = (await api('POST', '/api/login', { email: SECOND.email, password: SECOND.password })).body.token;
  tok.badmin = (await api('POST', '/api/login', { email: 'admin.b@fds.test', password: 'Cedar-Demo-2026' })).body.token;
  const NIL = '00000000-0000-4000-8000-000000000000';
  const t = S.today();

  // property A data (the main demo property)
  const a = (await api('GET', '/api/reservations', null, 'frontdesk')).body.find(r => r.full_name === 'Guest One');
  const aRate = (await api('GET', '/api/rates', null, 'admin')).body.find(r => r.approval_status === 'PENDING');
  const aRoom = (await api('GET', '/api/rooms', null, 'admin')).body.find(r => r.room_number === '101');
  const aType = (await api('GET', '/api/room-types', null, 'admin')).body[0];

  // what property B sees
  ok((await api('GET', '/api/reservations', null, 'b')).body.length === 0, 'B sees none of A\'s reservations');
  ok((await api('GET', '/api/rooms', null, 'b')).body.map(r => r.room_number).sort().join() === 'B101,B102', 'B sees only its own 2 rooms');
  ok((await api('GET', '/api/room-types', null, 'b')).body.map(r => r.name).join() === 'Single Room', 'B sees only its own room type');
  const bRates = (await api('GET', '/api/rates', null, 'badmin')).body;
  ok(bRates.length === 1 && bRates[0].room_type === 'Single Room', 'B manager sees only B\'s rate');
  const dash = (await api('GET', '/api/dashboard', null, 'b')).body;
  ok(dash.total_rooms === 2 && dash.arrivals.length === 0 && dash.in_house === 0, 'B dashboard counts only B (2 rooms, no arrivals)');
  ok((await api('GET', `/api/availability?from=${S.addDays(t, 10)}&to=${S.addDays(t, 11)}&guests=1`, null, 'b')).body.map(x => x.name).join() === 'Single Room', 'B availability lists only B\'s room type');
  const bAudit = (await api('GET', '/api/audit', null, 'badmin')).body;
  ok(bAudit.length > 0 && bAudit.every(r => ['Second Admin', 'Second Property Staff'].includes(r.full_name)), 'B audit log holds only B\'s own staff activity (none of A\'s)');

  // B cannot reach A's records by id: always 404, never 403
  for (const [label, r] of [
    ['read a reservation', await api('GET', `/api/reservations/${a.reservation_id}`, null, 'b')],
    ['cancel a reservation', await api('POST', `/api/reservations/${a.reservation_id}/cancel`, null, 'b')],
    ['check in', await api('POST', `/api/reservations/${a.reservation_id}/check-in`, null, 'b')],
    ['post a charge', await api('POST', `/api/reservations/${a.reservation_id}/charges`, { description: 'x', unit_price: 1 }, 'b')],
    ['record a payment', await api('POST', `/api/reservations/${a.reservation_id}/payments`, { amount: 1, method: 'CASH' }, 'b')],
    ['list free rooms', await api('GET', `/api/reservations/${a.reservation_id}/free-rooms`, null, 'b')],
    ['assign a room', await api('POST', `/api/reservations/${a.reservation_id}/assign-room`, { room_id: aRoom.room_id }, 'b')],
    ['change A\'s room status', await api('PATCH', `/api/rooms/${aRoom.room_id}/status`, { status: 'CLEANING' }, 'b')],
    ['approve A\'s rate (B admin)', await api('POST', `/api/rates/${aRate.rate_rule_id}/approve`, null, 'badmin')],
    ['create a rate on A\'s room type (B admin)', await api('POST', '/api/rates', { room_type_id: aType.room_type_id, rule_type: 'BASE', rate_amount: 1 }, 'badmin')],
    ['book A\'s room type', await api('POST', '/api/reservations', { guest: { full_name: 'X' }, room_type_id: aType.room_type_id, check_in: S.addDays(t, 10), check_out: S.addDays(t, 11), total_guests: 1, source_id: 1 }, 'b')],
  ]) ok(r.status === 404 && r.body.error.code === 'NOT_FOUND', `B tries to ${label}: 404 NOT_FOUND`);
  ok((await api('GET', `/api/reservations/${a.reservation_id}`, null, 'frontdesk')).status === 200 && (await api('GET', `/api/rates`, null, 'admin')).body.some(r => r.rate_rule_id === aRate.rate_rule_id && r.approval_status === 'PENDING'), 'none of that changed A\'s data');

  // and the other way round
  const bType = (await api('GET', '/api/room-types', null, 'b')).body[0];
  const made = await api('POST', '/api/reservations', { guest: { full_name: 'B Guest' }, room_type_id: bType.room_type_id, check_in: S.addDays(t, 10), check_out: S.addDays(t, 11), total_guests: 1, source_id: 1 }, 'b');
  ok(made.status === 201, 'B can book its own room type');
  ok((await api('GET', `/api/reservations/${made.body.reservation_id}`, null, 'admin')).status === 404, 'A cannot read B\'s reservation');
  ok(!(await api('GET', '/api/reservations', null, 'admin')).body.some(r => r.full_name === 'B Guest'), 'A\'s list does not contain B\'s reservation');
  ok((await api('GET', '/api/audit', null, 'admin')).body.every(r => r.full_name !== 'Second Admin' && r.full_name !== 'Second Property Staff'), 'A\'s audit log does not contain B\'s activity');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
