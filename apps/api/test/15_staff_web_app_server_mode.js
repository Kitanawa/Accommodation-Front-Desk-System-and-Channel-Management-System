// Staff web app in server mode: GET /api/frontdesk/state, guest profiles (/api/guests) and property details in /api/settings.
const { ok, summary, boot, api, tok } = require('./helpers');
const S = require('../service');
const { addSecondProperty } = require('../seed');
const { hashPassword } = require('../password');

(async () => {
  await boot();
  const db = await require('../db').connect();
  const p2 = await addSecondProperty(db);
  await db.q("insert into users(property_id,role_id,full_name,email,password_hash,can_approve_rates) values($1,1,'Second Admin','admin.b@fds.test',$2,true)", [p2.property_id, await hashPassword('Cedar-Demo-2026')]);
  tok.badmin = (await api('POST', '/api/login', { email: 'admin.b@fds.test', password: 'Cedar-Demo-2026' })).body.token;
  const t = S.today(), D = n => S.addDays(t, n), FD = 'frontdesk', MG = 'manager', AD = 'admin';
  const code = r => r.body && r.body.error && r.body.error.code;

  // ---------- GET /api/frontdesk/state ----------
  ok((await api('GET', '/api/frontdesk/state')).status === 401, 'the state needs a sign-in');
  const st = await api('GET', '/api/frontdesk/state', null, FD);
  ok(st.status === 200 && Array.isArray(st.body.rooms) && Array.isArray(st.body.bookings) && st.body.cleaning && Array.isArray(st.body.profiles) && st.body.settings.propertyName, 'the state has settings, rooms, bookings, cleaning and profiles');
  const rt = st.body.rooms[0];
  ok(rt.units.length === rt.stock && rt.units.every(u => u.roomId && u.id) && rt.pricing.baseRate > 0 && rt.pricing.baseRuleId && rt.publication === 'Published', 'a room type lists its rooms (number and id), its base rate and rule id, and is Published');
  const before = st.body.bookings.length;
  let n30 = 30; while (D(n30) <= '2027-01-03' && D(n30 + 2) > '2026-12-20') n30++;      // stay outside the seasonal rate (20 Dec to 3 Jan) so the total is two base nights on any run date
  const made = await api('POST', '/api/reservations', { room_type_id: rt.id, check_in: D(n30), check_out: D(n30 + 2), total_guests: 1, source_id: 1, guest: { full_name: 'State Guest', phone: '+60 12-111 0000' } }, FD);
  const st2 = (await api('GET', '/api/frontdesk/state', null, FD)).body, bk = st2.bookings.find(b => b.id === made.body.reservation_id);
  ok(made.status === 201 && st2.bookings.length === before + 1 && bk && bk.status === 'Upcoming' && bk.start === D(n30) && bk.end === D(n30 + 2) && bk.total === rt.pricing.baseRate * 2 && bk.guest.name === 'State Guest' && bk.guest.profileId, 'a new reservation shows up as Upcoming with dates, room total and guest profile id');
  const pay = await api('POST', `/api/reservations/${made.body.reservation_id}/payments`, { amount: 10, method: 'CASH' }, FD);
  const bk2 = (await api('GET', '/api/frontdesk/state', null, FD)).body.bookings.find(b => b.id === made.body.reservation_id);
  ok(pay.status === 201 && bk2.payments.length === 1 && bk2.payments[0].amountCents === 1000 && bk2.payments[0].method === 'Cash' && bk2.payments[0].receiptNo, 'a payment shows in cents with method and receipt number');
  const other = (await api('GET', '/api/frontdesk/state', null, 'badmin')).body;
  ok(!other.bookings.some(b => b.id === made.body.reservation_id) && !other.profiles.some(p => p.name === 'State Guest'), 'another property sees none of these reservations or guests');

  // a waiting price change shows as a rate request
  const rev = await api('POST', `/api/rates/${rt.pricing.baseRuleId}/revise`, { rate_amount: rt.pricing.baseRate + 10 }, MG);
  const rq = (await api('GET', '/api/frontdesk/state', null, FD)).body.rooms.find(r => r.id === rt.id);
  ok(rev.status === 201 && rq.rateRequest && rq.rateRequest.status === 'Pending Approval' && rq.rateRequest.pricing.baseRate === rt.pricing.baseRate + 10 && rq.pricing.baseRate === rt.pricing.baseRate && rq.rateRequest.ruleIds.length === 1, 'a price change waiting for approval is a rate request, and the approved price stays');
  ok((await api('POST', `/api/rates/${rt.pricing.baseRuleId}/revise`, { rate_amount: rt.pricing.baseRate + 5 }, FD)).status === 403, 'Front Desk cannot submit a price change (the server keeps rates.manage for Administrator and Manager)');
  await api('DELETE', `/api/rates/${rev.body.rate_rule_id}`, null, MG);
  const nt = await api('POST', '/api/room-types', { category_id: (await api('GET', '/api/room-categories', null, MG)).body[0].category_id, name: 'State Test Type', max_guests: 2, rates: [{ rule_type: 'BASE', rate_amount: 99 }] }, MG);
  const pend = (await api('GET', '/api/frontdesk/state', null, FD)).body.rooms.find(r => r.id === nt.body.room_type_id);
  ok(pend && pend.publication === 'Pending Approval' && pend.pricing.baseRate === 99 && pend.pricing.baseRuleId, 'a room type waiting for approval is Pending Approval and shows its submitted base rate');

  // ---------- /api/guests ----------
  ok((await api('GET', '/api/guests')).status === 401, 'guest profiles need a sign-in');
  const g1 = await api('POST', '/api/guests', { full_name: '  Ada Lovelace ', phone: '+60 12-222 0000', email: 'ada@example.test', nationality: 'British', language: 'English', requests: 'High floor' }, FD);
  ok(g1.status === 201 && g1.body.full_name === 'Ada Lovelace' && g1.body.guest_id && g1.body.language === 'English', 'a guest profile is added (name trimmed)');
  ok((await api('POST', '/api/guests', { phone: '1' }, FD)).status === 400 && (await api('POST', '/api/guests', { full_name: 'X', email: 'nope' }, FD)).status === 400, 'a name is required and e-mail must look like an e-mail');
  const list = (await api('GET', '/api/guests?q=lovelace', null, FD)).body;
  ok(list.length === 1 && list[0].guest_id === g1.body.guest_id, 'search finds the profile by name');
  const g1p = await api('PATCH', `/api/guests/${g1.body.guest_id}`, { phone: '+60 12-333 0000', address: '1 Road' }, FD);
  ok(g1p.status === 200 && g1p.body.phone === '+60 12-333 0000' && g1p.body.address === '1 Road' && g1p.body.full_name === 'Ada Lovelace', 'a profile is changed field by field');
  ok((await api('PATCH', `/api/guests/${g1.body.guest_id}`, {}, FD)).status === 400, 'sending nothing to change is refused');
  ok((await api('GET', `/api/guests?q=ada`, null, 'badmin')).body.length === 0 && (await api('PATCH', `/api/guests/${g1.body.guest_id}`, { phone: 'x' }, 'badmin')).status === 404, 'another property cannot see or change the profile');
  const booked = await api('POST', '/api/reservations', { room_type_id: rt.id, check_in: D(40), check_out: D(41), total_guests: 1, source_id: 1, guest_id: g1.body.guest_id }, FD);
  const bkg = (await api('GET', '/api/frontdesk/state', null, FD)).body.bookings.find(b => b.id === booked.body.reservation_id);
  ok(booked.status === 201 && bkg.guest.profileId === g1.body.guest_id && bkg.guest.name === 'Ada Lovelace', 'a reservation can use a saved profile');
  ok((await api('DELETE', `/api/guests/${g1.body.guest_id}`, null, FD)).status === 403, 'Front Desk cannot delete a profile');
  ok((await api('DELETE', `/api/guests/${g1.body.guest_id}`, null, MG)).status === 200, 'a Manager deletes the profile');
  const after = (await api('GET', '/api/frontdesk/state', null, FD)).body;
  ok(after.profiles.some(p => p.id === g1.body.guest_id && p.deleted) && !(await api('GET', '/api/guests?q=lovelace', null, FD)).body.length && after.bookings.find(b => b.id === booked.body.reservation_id).guest.name === 'Ada Lovelace', 'the deleted profile is hidden but the reservation keeps the guest details');
  ok((await api('POST', '/api/reservations', { room_type_id: rt.id, check_in: D(50), check_out: D(51), total_guests: 1, source_id: 1, guest_id: g1.body.guest_id }, FD)).status === 404, 'a deleted profile cannot be used for a new reservation');
  ok((await api('DELETE', `/api/guests/${g1.body.guest_id}`, null, AD)).status === 404, 'deleting it again says not found');

  // ---------- property details in /api/settings ----------
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  const s1 = await api('PATCH', '/api/settings', { property_name: '  Miri Harbour Hotel ', address: 'Jalan Test', contact_email: 'front@example.test', contact_phone: '+60 85-000 000', logo_data_url: logo, check_in_time: '15:30' }, MG);
  ok(s1.status === 200 && s1.body.property_name === 'Miri Harbour Hotel' && s1.body.address === 'Jalan Test' && s1.body.contact_email === 'front@example.test' && s1.body.logo_data_url === logo && s1.body.check_in_time === '15:30', 'name, address, contact, logo and check-in time are saved');
  const cur = (await api('GET', '/api/frontdesk/state', null, FD)).body.settings;
  ok(cur.propertyName === 'Miri Harbour Hotel' && cur.city === 'Jalan Test' && cur.arrivalTime === '15:30' && cur.logoDataUrl === logo && cur.contactEmail === 'front@example.test', 'the state shows the saved details');
  ok((await api('GET', '/api/frontdesk/state', null, 'badmin')).body.settings.propertyName !== 'Miri Harbour Hotel', 'another property keeps its own name');
  ok((await api('PATCH', '/api/settings', { property_name: 'X' }, MG)).status === 400 && (await api('PATCH', '/api/settings', { contact_email: 'bad' }, MG)).status === 400 && (await api('PATCH', '/api/settings', { logo_data_url: 'data:text/html;base64,PHNjcmlwdD4=' }, MG)).status === 400, 'a short name, a bad e-mail and a non-picture logo are refused');
  ok((await api('PATCH', '/api/settings', { property_name: 'Hack' }, FD)).status === 403, 'Front Desk cannot change property details');
  ok((await api('PATCH', '/api/settings', { logo_data_url: null }, MG)).body.logo_data_url === null, 'the logo can be removed');
  const audit = await db.q("select old_values, new_values from audit_records where action='SETTINGS_CHANGED' order by audit_id desc limit 3");
  ok(audit.length && !JSON.stringify(audit).includes('base64'), 'the audit log never holds the picture itself');

  // ---------- moving a guest who is in the house ----------
  const king = st.body.rooms.find(r => r.units.length >= 3 && r.id !== rt.id) || st.body.rooms.find(r => r.units.length >= 2);
  const mv = await api('POST', '/api/reservations', { room_type_id: king.id, check_in: t, check_out: D(2), total_guests: 1, source_id: 1, guest: { full_name: 'Mover' } }, FD);
  const [ra, rb] = king.units;
  await api('POST', `/api/reservations/${mv.body.reservation_id}/assign-room`, { room_id: ra.roomId }, FD);
  await api('POST', `/api/reservations/${mv.body.reservation_id}/check-in`, {}, FD);
  const moved = await api('POST', `/api/reservations/${mv.body.reservation_id}/assign-room`, { room_id: rb.roomId }, FD);
  const roomState = async id => (await db.q('select st.code from rooms r join room_statuses st using(status_id) where r.room_id=$1', [id]))[0].code;
  ok(moved.status === 200 && await roomState(ra.roomId) === 'CLEANING' && await roomState(rb.roomId) === 'OCCUPIED', 'moving a guest who is in the house sends the old room to cleaning and occupies the new one');
  const stm = (await api('GET', '/api/frontdesk/state', null, FD)).body;
  ok(stm.cleaning[ra.id] && stm.cleaning[ra.id].status === 'Dirty' && stm.bookings.find(b => b.id === mv.body.reservation_id).roomNumbers.join() === rb.id, 'the state shows the old room Dirty and the guest in the new room');
  const third = king.units[2];
  if (third) { await db.q("update rooms set status_id=3 where room_id=$1", [third.roomId]);
    ok((await api('POST', `/api/reservations/${mv.body.reservation_id}/assign-room`, { room_id: third.roomId }, FD)).status === 409, 'an in-house guest cannot be moved into a room that is not ready'); }

  summary();
})().catch(e => { console.error(e); process.exit(1); });
