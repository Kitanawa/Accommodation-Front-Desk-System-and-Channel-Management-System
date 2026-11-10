// M11 (S079 to S087): availability, holds, reservations, search, edits, cancel, No-Show, check-in, check-out.
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
  const t = S.today(), D = n => S.addDays(t, n), FD = 'frontdesk';
  const code = r => r.body && r.body.error && r.body.error.code;
  const fields = r => ((r.body.error || {}).fields || []).map(f => f.field).sort().join();
  const types = (await api('GET', '/api/room-types', null, FD)).body;
  const suite = types.find(x => x.name === 'Family Suite').room_type_id, twin = types.find(x => x.name === 'Standard Twin').room_type_id;
  const reserved = async (typeId, d) => (await db.q('select reserved_rooms r from room_stock where room_type_id=$1 and stock_date=$2', [typeId, d]))[0].r;
  const nights = async (typeId, from, n) => { const o = []; for (let i = 0; i < n; i++) o.push(await reserved(typeId, S.addDays(from, i))); return o.join(); };
  const book = (typeId, from, to, extra = {}) => api('POST', '/api/reservations', { guest: { full_name: 'M11 Guest' }, room_type_id: typeId, check_in: from, check_out: to, total_guests: 2, source_id: 1, ...extra }, FD);
  const get = id => api('GET', `/api/reservations/${id}`, null, FD);
  const roomStatus = async no => (await db.q('select st.code c from rooms r join room_statuses st using(status_id) where r.room_number=$1', [no]))[0].c;
  const auditHas = async a => (await db.q('select 1 x from audit_records where action=$1', [a])).length > 0;

  // ================= S079 availability =================
  const A = D(60), A2 = D(62);
  let av = await api('GET', `/api/availability?from=${A}&to=${A2}&guests=2&room_type_id=${suite}`, null, FD);
  ok(av.status === 200 && av.body.length === 1 && av.body[0].rooms_left === 2 && av.body[0].rooms_total === 2 && av.body[0].bookable, 'S079: one room type, 2 of 2 rooms left, bookable');
  ok((await api('GET', `/api/availability?check_in=${A}&check_out=${A2}`, null, FD)).body.length >= 3, 'S079: check_in and check_out work as names too, all approved types are listed');
  ok(code(await api('GET', `/api/availability?from=${A}&to=${A2}&guests=0`, null, FD)) === 'VALIDATION_ERROR', 'S079: 0 guests is refused');
  ok(fields(await api('GET', `/api/availability?from=${D(-1)}&to=${A2}&room_type_id=abc`, null, FD)) === 'check_in,room_type_id', 'S079: past date and bad room type id are both reported');
  ok(fields(await api('GET', `/api/availability?from=${A}&to=${D(60 + 91)}`, null, FD)) === 'check_out', 'S079: more than 90 nights is refused');
  ok(fields(await api('GET', `/api/availability`, null, FD)) === 'check_in,check_out', 'S079: missing dates are reported');
  ok((await api('GET', `/api/availability?from=${A}&to=${A2}&room_type_id=${suite}`, null, 'badmin')).body.length === 0, 'S079: another property cannot see this room type');
  ok((await api('GET', `/api/availability?from=${A}&to=${A2}`)).status === 401, 'S079: sign-in is required');

  // ================= S080 holds =================
  const holdBody = { room_type_id: suite, check_in: A, check_out: A2, total_guests: 2 };
  const h1 = await api('POST', '/api/holds', holdBody, FD);
  ok(h1.status === 201 && h1.body.status === 'ACTIVE' && h1.body.check_in === A && Date.parse(h1.body.expires_at) > Date.now() + 14 * 60e3, 'S080: a hold is created for 15 minutes by default');
  ok(await nights(suite, A, 3) === '1,1,0', 'S080: the hold takes stock for each night but not for the check-out date');
  ok((await api('GET', `/api/availability?from=${A}&to=${A2}&room_type_id=${suite}`, null, FD)).body[0].rooms_left === 1, 'S080: availability counts the hold');
  ok(fields(await api('POST', '/api/holds', { ...holdBody, total_guests: 5 }, FD)) === 'total_guests', 'S080: more guests than the room type allows is refused');
  ok(fields(await api('POST', '/api/holds', { ...holdBody, check_out: S.addDays(A, 1) }, FD)) === 'check_out', 'S080: fewer nights than the minimum is refused');
  ok(fields(await api('POST', '/api/holds', { ...holdBody, minutes: 61 }, FD)) === 'minutes' && fields(await api('POST', '/api/holds', { ...holdBody, minutes: 0 }, FD)) === 'minutes', 'S080: minutes must be 1 to 60');
  ok(fields(await api('POST', '/api/holds', { ...holdBody, check_in: D(-3), check_out: D(-1) }, FD)) === 'check_in', 'S080: a past date is refused');
  ok((await api('POST', '/api/holds', holdBody, 'badmin')).status === 404, 'S080: another property gets 404 for this room type');
  const h2 = await api('POST', '/api/holds', holdBody, FD);
  ok(h2.status === 201 && await nights(suite, A, 2) === '2,2', 'S080: the second hold takes the last room');
  const h3 = await api('POST', '/api/holds', holdBody, FD);
  ok(h3.status === 409 && code(h3) === 'SOLD_OUT' && await nights(suite, A, 2) === '2,2', 'S080: a third hold is refused (SOLD_OUT) and changes nothing');
  const rel = await api('DELETE', `/api/holds/${h2.body.hold_id}`, null, FD);
  ok(rel.status === 200 && rel.body.status === 'RELEASED' && await nights(suite, A, 2) === '1,1', 'S080: releasing a hold gives the room back');
  ok((await api('DELETE', `/api/holds/${h2.body.hold_id}`, null, FD)).status === 200 && await nights(suite, A, 2) === '1,1', 'S080: releasing twice does not give it back twice');
  ok((await api('GET', `/api/holds/${h1.body.hold_id}`, null, 'badmin')).status === 404 && (await api('DELETE', `/api/holds/${h1.body.hold_id}`, null, 'badmin')).status === 404, 'S080: another property gets 404 for the hold');
  ok(code(await api('POST', `/api/holds/${h2.body.hold_id}/confirm`, { guest: { full_name: 'Late Guest' } }, FD)) === 'HOLD_EXPIRED', 'S080: a released hold cannot be confirmed (HOLD_EXPIRED)');
  ok(fields(await api('POST', `/api/holds/${h1.body.hold_id}/confirm`, {}, FD)) === 'guest.full_name', 'S080: confirming needs a guest');
  ok(await nights(suite, A, 2) === '1,1' && (await api('GET', `/api/holds/${h1.body.hold_id}`, null, FD)).body.status === 'ACTIVE', 'S080: a failed confirm leaves the hold alone');
  const c1 = await api('POST', `/api/holds/${h1.body.hold_id}/confirm`, { guest: { full_name: 'Held Guest', phone: '0123' }, source_id: 2 }, FD);
  ok(c1.status === 201 && await nights(suite, A, 2) === '1,1', 'S080: confirming turns the hold into a reservation without taking a second room');
  const R1 = (await get(c1.body.reservation_id)).body;
  ok(R1.status === 'CONFIRMED' && R1.source === 'Phone' && R1.charges.length === 2 && R1.total_charges > 0 && R1.check_in === A && R1.room_type === 'Family Suite', 'S080: the reservation has the hold\'s stay, the source and one room charge per night');
  const hv = (await api('GET', `/api/holds/${h1.body.hold_id}`, null, FD)).body;
  ok(hv.status === 'CONFIRMED' && hv.reservation_id === c1.body.reservation_id, 'S080: the hold shows its reservation');
  ok(code(await api('POST', `/api/holds/${h1.body.hold_id}/confirm`, { guest: { full_name: 'Again' } }, FD)) === 'INVALID_STATE' && code(await api('DELETE', `/api/holds/${h1.body.hold_id}`, null, FD)) === 'INVALID_STATE', 'S080: a confirmed hold can neither be confirmed again nor released');
  // expiry: the room comes back without any timer
  const h4 = (await api('POST', '/api/holds', holdBody, FD)).body;
  ok(await nights(suite, A, 2) === '2,2', 'S080: (setup) a new hold takes the last room');
  await db.q("update reservation_holds set expires_at=now()-interval '1 minute' where hold_id=$1", [h4.hold_id]);
  const exp = await api('POST', `/api/holds/${h4.hold_id}/confirm`, { guest: { full_name: 'Too Slow' } }, FD);
  ok(exp.status === 409 && code(exp) === 'HOLD_EXPIRED', 'S080: confirming after the time ran out is refused (HOLD_EXPIRED)');
  ok(await nights(suite, A, 2) === '1,1' && (await api('GET', `/api/holds/${h4.hold_id}`, null, FD)).body.status === 'EXPIRED', 'S080: the expired hold gave its room back, once');
  const h5 = (await api('POST', '/api/holds', holdBody, FD)).body;
  await db.q("update reservation_holds set expires_at=now()-interval '1 minute' where hold_id=$1", [h5.hold_id]);
  ok((await api('GET', `/api/availability?from=${A}&to=${A2}&room_type_id=${suite}`, null, FD)).body[0].rooms_left === 1 && await nights(suite, A, 2) === '1,1', 'S080: a search also gives expired holds back');
  await api('GET', `/api/holds/${h5.hold_id}`, null, FD);
  ok(await nights(suite, A, 2) === '1,1', 'S080: giving back twice never goes below the real count');
  ok(await auditHas('HOLD_CREATED') && await auditHas('HOLD_RELEASED'), 'S080: creating and releasing holds is in the audit trail');

  // ================= S081 create (walk-in, phone), no overbooking =================
  const B = D(80), B2 = D(82);
  const par = await Promise.all([1, 2, 3].map(i => book(suite, B, B2, { guest: { full_name: 'Race ' + i } })));
  const st = par.map(r => r.status).sort().join();
  ok(st === '201,201,409' && par.find(r => r.status === 409).body.error.code === 'SOLD_OUT', 'S081: three bookings at once for 2 rooms: two succeed, one is SOLD_OUT');
  ok(await nights(suite, B, 3) === '2,2,0', 'S081: stock shows exactly 2 rooms taken');
  const ph = await book(twin, D(61), D(62), { source_id: 2, guest: { full_name: 'Phone Guest', phone: '0198' }, special_requests: 'High floor' });
  ok(ph.status === 201 && (await get(ph.body.reservation_id)).body.source === 'Phone', 'S081: a phone reservation is created');
  const ex = await book(twin, D(61), D(62), { guest_id: (await get(ph.body.reservation_id)).body.guest_id, guest: undefined });
  ok(ex.status === 201 && (await get(ex.body.reservation_id)).body.full_name === 'Phone Guest', 'S081: an existing guest can be booked again');
  ok(fields(await book(twin, D(61), D(62), { source_id: 9 })) === 'source_id' && fields(await book(twin, D(61), D(62), { source_id: 'x' })) === 'source_id', 'S081: an unknown booking source is refused');
  ok((await book(twin, D(61), D(62), { guest_id: '00000000-0000-4000-8000-000000000000', guest: undefined })).status === 404, 'S081: an unknown guest is refused (404)');
  ok(fields(await book(twin, D(61), D(62), { total_guests: 3 })) === 'total_guests', 'S081: more guests than the type allows is refused');

  // ================= S082 search, filter, sort, paging =================
  const all = await api('GET', '/api/reservations', null, FD);
  const total = Number(all.headers.get('x-total-count'));
  ok(all.status === 200 && Array.isArray(all.body) && total >= 8 && all.headers.get('x-page') === '1' && all.headers.get('x-page-size') === '25' && all.body.length === Math.min(25, total), 'S082: array body with X-Total-Count, X-Page and X-Page-Size');
  const p1 = await api('GET', '/api/reservations?page_size=3&page=1&sort=reference&order=asc', null, FD), p2r = await api('GET', '/api/reservations?page_size=3&page=2&sort=reference&order=asc', null, FD);
  ok(p1.body.length === 3 && p2r.body.length === 3 && !p1.body.some(a => p2r.body.some(b => b.reservation_id === a.reservation_id)) && p1.headers.get('x-total-pages') === String(Math.ceil(total / 3)), 'S082: pages do not overlap and the page count is right');
  const bySort = async (sort, order) => (await api('GET', `/api/reservations?page_size=100&sort=${sort}&order=${order}`, null, FD)).body;
  const ci = (await bySort('check_in', 'asc')).map(r => r.check_in);
  ok(ci.length > 5 && ci.every((v, i) => !i || ci[i - 1] <= v), 'S082: sorted by check-in, ascending');
  const tot = (await bySort('total', 'desc')).map(r => r.total);
  ok(tot.every((v, i) => !i || tot[i - 1] >= v), 'S082: sorted by total, descending');
  const mine = await api('GET', '/api/reservations?q=Phone%20Guest', null, FD);
  ok(mine.body.length === 2 && mine.body.every(r => r.full_name === 'Phone Guest') && mine.body[0].phone === '0198', 'S082: search by guest name');
  ok((await api('GET', '/api/reservations?q=0198', null, FD)).body.length === 2, 'S082: search by phone number');
  ok((await api('GET', `/api/reservations?q=${R1.reservation_ref}`, null, FD)).body.length === 1, 'S082: search by reference');
  ok((await api('GET', '/api/reservations?q=%25', null, FD)).body.length === 0, 'S082: a % in the search text is plain text, not a wildcard');
  ok((await api('GET', '/api/reservations?source_id=2&page_size=100', null, FD)).body.every(r => r.source === 'Phone') && (await api('GET', `/api/reservations?room_type_id=${twin}&check_in_from=${D(61)}&check_in_to=${D(61)}&page_size=100`, null, FD)).body.length === 2, 'S082: filters by source, room type and arrival dates');
  ok((await api('GET', '/api/reservations?status=CONFIRMED&payment_status=UNPAID&page_size=100', null, FD)).body.every(r => r.status === 'CONFIRMED' && r.payment_status === 'UNPAID'), 'S082: filters by status and payment status');
  ok((await api('GET', '/api/reservations?status=NO_SHOW', null, FD)).status === 200, 'S082: NO_SHOW is a valid status filter');
  const badq = await api('GET', '/api/reservations?status=LOST&sort=hack&order=up&page=0&page_size=101&check_in_from=soon&source_id=7&payment_status=x&room_type_id=1', null, FD);
  ok(badq.status === 400 && fields(badq) === 'check_in_from,order,page,page_size,payment_status,room_type_id,sort,source_id,status', 'S082: every wrong filter is reported at once');
  ok((await api('GET', `/api/reservations?q=Phone`, null, 'badmin')).body.length === 0 && Number((await api('GET', '/api/reservations', null, 'badmin')).headers.get('x-total-count')) === 0, 'S082: another property sees none of these');

  // ================= S083 edits =================
  const E = D(70);
  const r2 = (await book(suite, E, S.addDays(E, 2))).body, id2 = r2.reservation_id;
  const old = (await get(id2)).body;
  const e1 = await api('PATCH', `/api/reservations/${id2}`, { phone: '0555', email: 'new@example.test', notes: 'Late arrival' }, FD);
  ok(e1.status === 200 && e1.body.phone === '0555' && e1.body.email === 'new@example.test' && e1.body.notes === 'Late arrival' && e1.body.total_charges === old.total_charges, 'S083: guest details and notes change, the price does not');
  ok(fields(await api('PATCH', `/api/reservations/${id2}`, { email: 'nope', full_name: '  ' }, FD)) === 'email,full_name', 'S083: a bad email and an empty name are reported');
  ok(fields(await api('PATCH', `/api/reservations/${id2}`, { check_in: D(-1) }, FD)).includes('check_in') && fields(await api('PATCH', `/api/reservations/${id2}`, { check_out: E }, FD)) === 'check_out', 'S083: a past check-in and a check-out before check-in are refused');
  const e2 = await api('PATCH', `/api/reservations/${id2}`, { check_in: S.addDays(E, 1), check_out: S.addDays(E, 4) }, FD);
  ok(e2.status === 200 && e2.body.check_in === S.addDays(E, 1) && e2.body.charges.filter(c => c.charge_type === 'ROOM').length === 3, 'S083: new dates, three room-night charges');
  ok(await nights(suite, E, 5) === '0,1,1,1,0', 'S083: the old nights went back and the new nights were taken');
  ok(Math.abs(e2.body.rate_total - e2.body.charges.reduce((s, c) => s + c.amount, 0)) < 0.005 && e2.body.balance === e2.body.total_charges, 'S083: the booked total equals the charges');
  // sold-out target: fill both suites on C, then try to move onto them
  const C = D(100);
  await book(suite, C, S.addDays(C, 2)); await book(suite, C, S.addDays(C, 2));
  const before = (await get(id2)).body, stockBefore = await nights(suite, S.addDays(E, 1), 3);
  const e3 = await api('PATCH', `/api/reservations/${id2}`, { check_in: S.addDays(C, 1), check_out: S.addDays(C, 3) }, FD);
  ok(e3.status === 409 && code(e3) === 'SOLD_OUT', 'S083: moving onto sold-out nights is refused');
  const after = (await get(id2)).body;
  ok(after.check_in === before.check_in && after.total_charges === before.total_charges && after.charges.length === before.charges.length && await nights(suite, S.addDays(E, 1), 3) === stockBefore && await nights(suite, S.addDays(C, 1), 2) === '2,0', 'S083: a refused change leaves dates, charges and stock exactly as they were');
  // room type change clears the assigned room
  const F = D(90), r4 = (await book(suite, F, S.addDays(F, 2))).body.reservation_id;
  await api('POST', `/api/reservations/${r4}/assign-room`, { room_id: (await api('GET', `/api/reservations/${r4}/free-rooms`, null, FD)).body[0].room_id }, FD);
  const twinBefore = await nights(twin, F, 2);
  ok(fields(await api('PATCH', `/api/reservations/${r4}`, { room_type_id: twin, total_guests: 3 }, FD)) === 'total_guests', 'S083: too many guests for the new room type is refused');
  const e4 = await api('PATCH', `/api/reservations/${r4}`, { room_type_id: twin, total_guests: 2 }, FD);
  ok(e4.status === 200 && e4.body.room_type === 'Standard Twin' && e4.body.room_id === null && e4.body.charges.every(c => /Standard Twin/.test(c.description)), 'S083: room type changed, assigned room cleared, charges priced for the new type');
  ok(await nights(suite, F, 2) === '0,0' && await nights(twin, F, 2) === twinBefore.split(',').map(Number).map(n => n + 1).join(), 'S083: stock moved from the old type to the new one');
  // stay extension after check-in
  const T0 = await nights(twin, t, 4);
  const r5 = (await book(twin, t, D(1))).body.reservation_id;
  const in5 = await api('POST', `/api/reservations/${r5}/check-in`, null, FD);
  ok(in5.status === 200 && in5.body.status === 'CHECKED_IN', 'S083: (setup) guest checked in');
  const room5 = in5.body.room_number, c5 = in5.body.charges.length;
  ok(code(await api('PATCH', `/api/reservations/${r5}`, { room_type_id: suite }, FD)) === 'INVALID_STATE' && code(await api('PATCH', `/api/reservations/${r5}`, { check_in: D(1) }, FD)) === 'INVALID_STATE', 'S083: after check-in the room type and arrival cannot change');
  const x1 = await api('PATCH', `/api/reservations/${r5}`, { check_out: D(3) }, FD);
  ok(x1.status === 200 && x1.body.check_out === D(3) && x1.body.charges.length === c5 + 2 && x1.body.charges.slice(0, c5).every((c, i) => c.amount === in5.body.charges[i].amount), 'S083: extending adds charges for the new nights only');
  ok(await nights(twin, t, 4) === T0.split(',').map(Number).map((n, i) => n + (i < 3 ? 1 : 0)).join(), 'S083: stock is taken for the extra nights');
  ok(code(await api('PATCH', `/api/reservations/${r5}`, { check_out: D(2) }, FD)) === 'INVALID_STATE', 'S083: a stay cannot be shortened by editing');
  const r6 = (await book(twin, D(3), D(4))).body.reservation_id;
  const free6 = (await api('GET', `/api/reservations/${r6}/free-rooms`, null, FD)).body.find(r => r.room_number === room5);
  await api('POST', `/api/reservations/${r6}/assign-room`, { room_id: free6.room_id }, FD);
  const T1 = await nights(twin, t, 5);
  const x2 = await api('PATCH', `/api/reservations/${r5}`, { check_out: D(4) }, FD);
  ok(x2.status === 409 && code(x2) === 'ROOM_NOT_AVAILABLE' && await nights(twin, t, 5) === T1, 'S083: an extension onto a night the room is promised to someone else is refused, stock unchanged');

  // ================= S085 No-Show (and the arrival-day rules) =================
  ok(code(await api('POST', `/api/reservations/${id2}/no-show`, { remark: 'Did not come' }, FD)) === 'INVALID_STATE', 'S085: before the arrival date a No-Show is refused');
  const r7 = (await book(twin, t, D(1))).body.reservation_id;
  const T2 = await nights(twin, t, 2);
  ok(fields(await api('POST', `/api/reservations/${r7}/no-show`, {}, FD)) === 'remark' && fields(await api('POST', `/api/reservations/${r7}/no-show`, { remark: '   ' }, FD)) === 'remark' && fields(await api('POST', `/api/reservations/${r7}/no-show`, { remark: 'x'.repeat(301) }, FD)) === 'remark', 'S085: the remark is mandatory (not empty, not blank, at most 300 characters)');
  ok((await get(r7)).body.status === 'CONFIRMED', 'S085: a refused No-Show changes nothing');
  const ns = await api('POST', `/api/reservations/${r7}/no-show`, { remark: 'Called, will not come' }, FD);
  ok(ns.status === 200 && ns.body.status === 'NO_SHOW' && ns.body.status_remark === 'Called, will not come' && ns.body.status_changed_at, 'S085: marked NO_SHOW with the remark and time');
  ok(await nights(twin, t, 2) === T2.split(',').map(Number).map((n, i) => n - (i ? 0 : 1)).join(), 'S085: the room goes back to stock');
  const aud = (await db.q("select new_values v from audit_records where action='RESERVATION_NO_SHOW' and entity_id=$1", [r7]))[0];
  ok(aud && aud.v.remark === 'Called, will not come' && aud.v.status === 'NO_SHOW', 'S085: the audit trail records the remark');
  ok(code(await api('POST', `/api/reservations/${r7}/no-show`, { remark: 'again' }, FD)) === 'INVALID_STATE' && code(await api('POST', `/api/reservations/${r7}/check-in`, null, FD)) === 'INVALID_STATE' && code(await api('PATCH', `/api/reservations/${r7}`, { notes: 'x' }, FD)) === 'INVALID_STATE', 'S085: a No-Show cannot be repeated, checked in or edited');
  ok((await api('GET', '/api/reservations?status=NO_SHOW', null, FD)).body.some(r => r.reservation_id === r7), 'S085: it appears under the NO_SHOW filter');
  ok((await api('POST', `/api/reservations/${r7}/no-show`, { remark: 'x' }, 'badmin')).status === 404, 'S085: another property gets 404');

  // ================= S084 cancel =================
  const stockC = await nights(suite, S.addDays(E, 1), 3);
  ok(fields(await api('POST', `/api/reservations/${id2}/cancel`, { remark: 'x'.repeat(301) }, FD)) === 'remark', 'S084: a remark over 300 characters is refused');
  ok((await api('POST', `/api/reservations/${id2}/cancel`, { remark: 'x' }, 'badmin')).status === 404, 'S084: another property gets 404');
  const cn = await api('POST', `/api/reservations/${id2}/cancel`, { remark: 'Guest changed plans' }, FD);
  ok(cn.status === 200 && cn.body.status === 'CANCELLED' && cn.body.status_remark === 'Guest changed plans', 'S084: cancelled, with the remark');
  ok(await nights(suite, S.addDays(E, 1), 3) === stockC.split(',').map(Number).map(n => n - 1).join(), 'S084: the nights go back to stock');
  ok(code(await api('POST', `/api/reservations/${id2}/cancel`, null, FD)) === 'INVALID_STATE' && code(await api('PATCH', `/api/reservations/${id2}`, { notes: 'x' }, FD)) === 'INVALID_STATE', 'S084: cancelling twice and editing a cancelled reservation are refused, stock is not returned twice');
  ok(await nights(suite, S.addDays(E, 1), 3) === stockC.split(',').map(Number).map(n => n - 1).join(), 'S084: (check) stock unchanged by the refused second cancel');
  ok(code(await api('POST', `/api/reservations/${r5}/cancel`, null, FD)) === 'INVALID_STATE', 'S084: a checked-in stay cannot be cancelled');
  const rc = (await book(twin, D(5), D(6))).body.reservation_id;
  await api('POST', `/api/reservations/${rc}/assign-room`, { room_id: (await api('GET', `/api/reservations/${rc}/free-rooms`, null, FD)).body[0].room_id }, FD);
  ok((await api('POST', `/api/reservations/${rc}/cancel`, null, FD)).body.room_id === null, 'S084: cancelling without a body works and frees the assigned room');
  ok(await S.releaseStock(db.q, twin, D(-2), D(-1)) === 0 && await reserved(twin, D(-2)) === 0, 'S084: nights before today are never returned');

  // ================= S086 check-in =================
  ok(code(await api('POST', `/api/reservations/${r6}/check-in`, null, FD)) === 'INVALID_STATE', 'S086: before the arrival date check-in is refused');
  ok(fields(await api('POST', `/api/reservations/${r6}/check-in`, { room_id: 'x' }, FD)) === 'room_id', 'S086: a bad room id is reported');
  const r8 = (await book(twin, t, D(1))).body.reservation_id, r9 = (await book(twin, t, D(1))).body.reservation_id;
  const sute = (await db.q("select room_id from rooms where room_type_id=$1 and room_number='301'", [suite]))[0].room_id;
  ok(code(await api('POST', `/api/reservations/${r8}/check-in`, { room_id: sute }, FD)) === 'ROOM_NOT_AVAILABLE', 'S086: a room of another type is refused');
  const freeTwin = (await api('GET', `/api/reservations/${r8}/free-rooms`, null, FD)).body.filter(r => r.status === 'AVAILABLE');
  const [roomX] = freeTwin;
  const both = await Promise.all([r8, r9].map(id => api('POST', `/api/reservations/${id}/check-in`, { room_id: roomX.room_id }, FD)));
  ok(both.map(r => r.status).sort().join() === '200,409' && await roomStatus(roomX.room_number) === 'OCCUPIED', 'S086: two check-ins into the same room at once: one wins, one is refused');
  const winner = both.find(r => r.status === 200).body, loser = both.find(r => r.status === 409);
  ok(code(loser) === 'ROOM_NOT_AVAILABLE' && winner.room_number === roomX.room_number && winner.checked_in_at, 'S086: the loser gets ROOM_NOT_AVAILABLE, the winner has the room and a check-in time');
  const loserId = both[0].status === 409 ? r8 : r9;
  await db.q("update rooms set status_id=4 where room_type_id=$1 and status_id=1", [twin]);
  ok(code(await api('POST', `/api/reservations/${loserId}/check-in`, null, FD)) === 'ROOM_NOT_AVAILABLE' && (await get(loserId)).body.status === 'CONFIRMED', 'S086: no ready room: refused and the reservation stays CONFIRMED');
  await db.q("update rooms set status_id=1 where room_type_id=$1 and status_id=4", [twin]);
  const ok9 = await api('POST', `/api/reservations/${loserId}/check-in`, null, FD);
  ok(ok9.status === 200 && ok9.body.room_number && ok9.body.room_number !== roomX.room_number, 'S086: with rooms ready again, a room is assigned automatically');
  ok(code(await api('POST', `/api/reservations/${loserId}/check-in`, null, FD)) === 'INVALID_STATE', 'S086: a second check-in is refused');
  ok((await api('POST', `/api/reservations/${loserId}/check-in`, null, 'badmin')).status === 404, 'S086: another property gets 404');

  // ================= S087 check-out =================
  const T3 = await nights(twin, t, 4), pre = (await get(r5)).body;
  const owe = await api('POST', `/api/reservations/${r5}/check-out`, null, FD);
  ok(owe.status === 409 && code(owe) === 'BALANCE_OUTSTANDING' && (await get(r5)).body.status === 'CHECKED_IN', 'S087: an unpaid balance blocks check-out and changes nothing');
  ok((await api('POST', `/api/reservations/${r5}/payments`, { amount: pre.balance, method: 'CASH' }, FD)).status === 201, 'S087: (setup) the balance is paid');
  ok((await api('POST', `/api/reservations/${r5}/check-out`, null, 'badmin')).status === 404, 'S087: another property gets 404');
  const out = await api('POST', `/api/reservations/${r5}/check-out`, null, FD);
  ok(out.status === 200 && out.body.status === 'CHECKED_OUT' && out.body.checked_out_at && out.body.closed_at, 'S087: checked out, folio closed, time recorded');
  ok(await roomStatus(room5) === 'CLEANING', 'S087: the room is now dirty (CLEANING)');
  ok(await nights(twin, t, 4) === T3.split(',').map(Number).map((n, i) => n - (i < 3 ? 1 : 0)).join(), 'S087: leaving before the booked check-out returns the unused nights to stock');
  ok(code(await api('POST', `/api/reservations/${r5}/check-out`, null, FD)) === 'INVALID_STATE', 'S087: a second check-out is refused');
  ok(code(await api('POST', `/api/reservations/${r5}/charges`, { description: 'Late', unit_price: 5 }, FD)) === 'FOLIO_CLOSED', 'S087: the closed folio takes no more charges');
  const nr = (await book(twin, t, D(1))).body.reservation_id;
  await db.q("update rooms set status_id=3 where room_number=$1", [room5]);
  const dirty = await api('POST', `/api/reservations/${nr}/check-in`, { room_id: (await db.q('select room_id from rooms where room_number=$1', [room5]))[0].room_id }, FD);
  ok(dirty.status === 409 && code(dirty) === 'ROOM_NOT_AVAILABLE', 'S087: a dirty room cannot be checked into until it is cleaned');

  // ================= whole-system stock check =================
  const bad = await db.q(`select s.room_type_id, s.stock_date::text d, s.reserved_rooms r,
      (select count(*) from reservation_rooms rr join reservations x using(reservation_id) where rr.room_type_id=s.room_type_id and x.status in ('CONFIRMED','CHECKED_IN') and x.check_in_date<=s.stock_date and x.check_out_date>s.stock_date)
    + (select count(*) from reservation_holds h where h.room_type_id=s.room_type_id and h.status='ACTIVE' and h.check_in_date<=s.stock_date and h.check_out_date>s.stock_date) c
    from room_stock s where s.stock_date>=$1::date`, [t]);
  const off = bad.filter(x => Number(x.c) !== x.r);
  ok(off.length === 0, 'Stock: for every room type and every night from today, reserved rooms = live reservations + live holds' + (off.length ? ' ' + JSON.stringify(off.slice(0, 3)) : ''));
  ok(await auditHas('RESERVATION_CANCELLED') && await auditHas('CHECKED_IN') && await auditHas('CHECKED_OUT') && await auditHas('RESERVATION_UPDATED'), 'FR-22: edits, cancellation, check-in and check-out are in the audit trail');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
