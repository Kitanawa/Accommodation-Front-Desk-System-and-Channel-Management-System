// M11 (S079 to S087): availability, holds, reservations, status changes, check-in and check-out.
// Every change to room_stock goes through the helpers in service.js. Every status change locks the reservation row first
// and uses a guarded update, so two staff members pressing a button at the same moment cannot both win.
const S = require('./service');
const Cancellation = require('./cancellation');
const { bad, notFound, conflict, Fields, isUuid } = require('./errors');

const STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];
const SORTS = { check_in: 'r.check_in_date', check_out: 'r.check_out_date', created_at: 'r.created_at', guest: 'g.full_name', reference: 'r.reservation_ref', total: 'total' };
const HOLD_DEFAULT_MIN = 15, HOLD_MAX_MIN = 60;

module.exports = function mount(app, { getDb, auth, need, wrap }) {
  const db = () => getDb();
  const q = (s, p) => db().q(s, p);
  const prop = req => req.user.property_id;
  const manage = [auth, need('reservations.manage')], operate = [auth, need('stay.operate')];
  const view = (req, id) => S.getReservation(q, prop(req), id);
  const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
  const optText = (f, name, v, max) => { if (v === undefined || v === null || v === '') return null; if (typeof v !== 'string' || v.trim().length > max) f.add(name, `Text of at most ${max} characters.`); return typeof v === 'string' ? v.trim() : null; };

  // takes the reservation row lock; also proves it belongs to the caller's property (other property = 404)
  async function lockRes(t, propertyId, id) {
    const [x] = await t.q('select reservation_id from reservations where reservation_id=$1 and property_id=$2 for update', [id, propertyId]);
    if (!x) throw notFound('Reservation not found.');
  }
  async function typeOf(qq, propertyId, id) {
    const [t] = await qq(`select t.room_type_id, t.name, t.max_guests, t.min_nights, t.approval_status from room_types t join room_categories c using(category_id)
      where t.room_type_id=$1 and c.property_id=$2`, [id, propertyId]);
    if (!t) throw notFound('Room type not found.');
    if (t.approval_status !== 'APPROVED') throw conflict('This room type is waiting for approval and cannot be sold yet.', 'INVALID_STATE');
    return t;
  }
  // room nights are replaced by voiding the old ones and recording the new ones: recorded charges are never edited or deleted (S097)
  async function replaceRoomCharges(t, folioId, rt, price, userId) {
    await t.q("update charges set voided_at=now(), voided_by=$2, void_reason='Stay changed' where folio_id=$1 and charge_type='ROOM' and voided_at is null", [folioId, userId]);
    for (const nt of price.nights) await t.q(`insert into charges(folio_id,charge_type,description,quantity,unit_price,amount,stay_date) values($1,'ROOM',$2,1,$3,$3,$4)`, [folioId, `Room night ${nt.date} (${rt.name})`, nt.rate, nt.date]);
  }

  // ---------- S079 availability ----------
  app.get('/api/availability', ...manage, wrap(async (req, res) => {
    const { check_in, check_out } = req.query;
    res.json(await S.availability(q, prop(req), { from: check_in ?? req.query.from, to: check_out ?? req.query.to, guests: req.query.guests, room_type_id: req.query.room_type_id }));
  }));

  // ---------- S080 holds ----------
  async function validateStay(qq, propertyId, p) {
    const f = S.checkDates(p.check_in, p.check_out);
    const guests = Number(p.total_guests);
    if (!Number.isInteger(guests) || guests < 1) f.add('total_guests', 'Number of guests must be 1 or more.');
    if (!isUuid(p.room_type_id)) f.add('room_type_id', 'Choose a room type.');
    f.check();
    const rt = await typeOf(qq, propertyId, p.room_type_id), n = S.nightsList(p.check_in, p.check_out).length;
    if (guests > rt.max_guests) throw bad(`${rt.name} allows at most ${rt.max_guests} guests.`, [{ field: 'total_guests', message: `At most ${rt.max_guests} guests.` }]);
    if (n < rt.min_nights) throw bad(`${rt.name} requires at least ${rt.min_nights} nights.`, [{ field: 'check_out', message: `Minimum ${rt.min_nights} nights.` }]);
    return { rt, guests };
  }
  const holdSql = `select h.hold_id, h.room_type_id, h.check_in_date::text check_in, h.check_out_date::text check_out, h.total_guests, h.status, h.expires_at, h.reservation_id,
      (h.status='ACTIVE' and h.expires_at<now()) expired
    from reservation_holds h join room_types t using(room_type_id) join room_categories c using(category_id) where h.hold_id=$1 and c.property_id=$2`;
  const readHold = async (qq, req, forUpdate) => {
    const [h] = await qq(holdSql + (forUpdate ? ' for update of h' : ''), [req.params.id, prop(req)]);
    if (!h) throw notFound('Hold not found.');
    return h;
  };

  app.post('/api/holds', ...manage, wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    let mins = (await S.settings(q, prop(req))).hold_minutes;               // property policy (S105), 15 unless changed
    if (b.minutes !== undefined) { mins = Number(b.minutes); if (!Number.isInteger(mins) || mins < 1 || mins > HOLD_MAX_MIN) f.add('minutes', `Whole number of minutes from 1 to ${HOLD_MAX_MIN}.`); }
    f.check();
    await S.sweepHolds(q);
    const h = await db().tx(async t => {
      const { rt, guests } = await validateStay(t.q, prop(req), b);
      await S.reserveStock(t.q, rt, b.check_in, b.check_out);
      const [h] = await t.q(`insert into reservation_holds(room_type_id,check_in_date,check_out_date,total_guests,expires_at,created_by)
        values($1,$2,$3,$4,now()+make_interval(mins => $5),$6) returning hold_id`, [rt.room_type_id, b.check_in, b.check_out, guests, mins, req.user.user_id]);
      await S.audit(t.q, req.user.user_id, 'HOLD_CREATED', 'reservation_holds', h.hold_id, null, { room_type: rt.name, check_in: b.check_in, check_out: b.check_out, minutes: mins });
      return h;
    });
    const [out] = await q(holdSql, [h.hold_id, prop(req)]);
    res.status(201).json(out);
  }));
  app.get('/api/holds/:id', ...manage, wrap(async (req, res) => { await S.sweepHolds(q); res.json(await readHold(q, req)); }));
  app.delete('/api/holds/:id', ...manage, wrap(async (req, res) => {
    await readHold(q, req);
    const out = await db().tx(async t => {
      const h = await readHold(t.q, req, true);
      if (h.status === 'CONFIRMED') throw conflict('This hold already became a reservation.', 'INVALID_STATE');
      if (h.status === 'ACTIVE') {                                  // an expired-but-not-yet-swept hold is released here too
        await t.q("update reservation_holds set status='RELEASED' where hold_id=$1 and status='ACTIVE'", [h.hold_id]);
        await S.lockStock(t.q, h.room_type_id, h.check_in, h.check_out);
        await t.q('update room_stock set reserved_rooms=greatest(reserved_rooms-1,0) where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [h.room_type_id, h.check_in, h.check_out]);
        await S.audit(t.q, req.user.user_id, 'HOLD_RELEASED', 'reservation_holds', h.hold_id, { status: 'ACTIVE' }, { status: 'RELEASED' });
      }
      return readHold(t.q, req);
    });
    res.json(out);
  }));
  // Confirm: the hold keeps the rooms, so booking cannot fail for lack of stock. Stay details come from the hold.
  app.post('/api/holds/:id/confirm', ...manage, wrap(async (req, res) => {
    await readHold(q, req);
    await S.sweepHolds(q);                                          // outside the transaction, so giving the room back survives the error below
    const r = await db().tx(async t => {
      const h = await readHold(t.q, req, true);
      if (h.status === 'CONFIRMED') throw conflict('This hold already became a reservation.', 'INVALID_STATE');
      if (h.status !== 'ACTIVE' || h.expired) throw conflict('The hold has expired or was released. Search availability again.', 'HOLD_EXPIRED');
      const p = { ...(req.body || {}), room_type_id: h.room_type_id, check_in: h.check_in, check_out: h.check_out, total_guests: h.total_guests };
      return S.createReservation(t, prop(req), p, req.user.user_id, { hold: h });
    });
    res.status(201).json(r);
  }));

  // ---------- S081 create (walk-in, phone and the other sources) ----------
  app.post('/api/reservations', ...manage, wrap(async (req, res) => {
    const r = await db().tx(t => S.createReservation(t, prop(req), req.body || {}, req.user.user_id));
    res.status(201).json(r);
  }));

  // ---------- S082 search, filter, sort, paginate (array body; paging in headers) ----------
  app.get('/api/reservations', ...manage, wrap(async (req, res) => {
    const Q = req.query, f = new Fields(), params = [prop(req)], where = ['r.property_id=$1'];
    const add = (cond, v) => { params.push(v); where.push(cond.replace('?', '$' + params.length)); };
    if (Q.status) { if (!STATUSES.includes(Q.status)) f.add('status', `Must be one of ${STATUSES.join(', ')}.`); else add('r.status=?', Q.status); }
    if (Q.payment_status) { if (!['UNPAID', 'PARTIAL', 'PAID'].includes(Q.payment_status)) f.add('payment_status', 'Must be UNPAID, PARTIAL or PAID.'); else add('r.payment_status=?', Q.payment_status); }
    if (Q.source_id) { if (!/^[1-6]$/.test(Q.source_id)) f.add('source_id', 'Must be 1 to 6.'); else add('r.source_id=?', Number(Q.source_id)); }
    if (Q.room_type_id) { if (!isUuid(Q.room_type_id)) f.add('room_type_id', 'Must be a UUID.'); else add('rr.room_type_id=?', Q.room_type_id); }
    for (const [k, col, op] of [['check_in_from', 'r.check_in_date', '>='], ['check_in_to', 'r.check_in_date', '<='], ['check_out_from', 'r.check_out_date', '>='], ['check_out_to', 'r.check_out_date', '<=']]) {
      if (Q[k] === undefined || Q[k] === '') continue;
      if (!S.isDate(Q[k])) f.add(k, 'Must be a date (YYYY-MM-DD).'); else add(`${col} ${op} ?::date`, Q[k]);
    }
    if (Q.q) { const s = String(Q.q).trim().slice(0, 100); if (s) { params.push(like(s)); const n = '$' + params.length;
      where.push(`(r.reservation_ref ilike ${n} or g.full_name ilike ${n} or g.phone ilike ${n} or g.email ilike ${n} or rm.room_number ilike ${n})`); } }
    const sort = Q.sort === undefined ? 'check_in' : Q.sort, order = (Q.order || 'desc').toLowerCase();
    if (!SORTS[sort]) f.add('sort', `Must be one of ${Object.keys(SORTS).join(', ')}.`);
    if (!['asc', 'desc'].includes(order)) f.add('order', 'Must be asc or desc.');
    const page = Q.page === undefined ? 1 : Number(Q.page), size = Q.page_size === undefined ? 25 : Number(Q.page_size);
    if (!Number.isInteger(page) || page < 1) f.add('page', 'Whole number, 1 or more.');
    if (!Number.isInteger(size) || size < 1 || size > 100) f.add('page_size', 'Whole number from 1 to 100.');
    f.check();
    const from = `from reservations r join guests g using(guest_id) join booking_sources s using(source_id) join reservation_rooms rr using(reservation_id)
      join room_types tp on tp.room_type_id=rr.room_type_id left join rooms rm on rm.room_id=rr.room_id where ${where.join(' and ')}`;
    const [{ n }] = await q(`select count(*)::int n ${from}`, params);
    const rows = await q(`select r.reservation_id, r.reservation_ref, g.full_name, g.phone, tp.name room_type, rm.room_number, r.check_in_date::text check_in, r.check_out_date::text check_out,
      r.total_guests, r.status, r.payment_status, s.name source, r.created_at,
      (select coalesce(sum(c.amount),0)::float8 from charges c join folios fo using(folio_id) where fo.reservation_id=r.reservation_id) total
      ${from} order by ${SORTS[sort]} ${order}, r.reservation_ref limit ${size} offset ${(page - 1) * size}`, params);
    res.set({ 'X-Total-Count': String(n), 'X-Page': String(page), 'X-Page-Size': String(size), 'X-Total-Pages': String(Math.max(1, Math.ceil(n / size))) });
    res.json(rows);
  }));
  app.get('/api/reservations/:id', ...manage, wrap(async (req, res) => res.json(await view(req, req.params.id))));

  // ---------- S083 edit: guest details and notes, dates, room type, guests, extension ----------
  app.patch('/api/reservations/:id', ...manage, wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    const name = b.full_name === undefined ? null : String(b.full_name).trim();
    if (name !== null && !name) f.add('full_name', 'Guest full name cannot be empty.');
    const phone = optText(f, 'phone', b.phone, 40), email = optText(f, 'email', b.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) f.add('email', 'Not a valid email address.');
    const requests = optText(f, 'special_requests', b.special_requests, 500), notes = optText(f, 'notes', b.notes, 500);
    if (b.estimated_arrival && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(b.estimated_arrival)) f.add('estimated_arrival', 'Time as HH:MM.');
    if (b.room_type_id !== undefined && !isUuid(b.room_type_id)) f.add('room_type_id', 'Must be a room type id (UUID).');
    if (b.check_in !== undefined && !S.isDate(b.check_in)) f.add('check_in', 'Check-in must be a date (YYYY-MM-DD).');
    if (b.check_out !== undefined && !S.isDate(b.check_out)) f.add('check_out', 'Check-out must be a date (YYYY-MM-DD).');
    if (b.total_guests !== undefined && !(Number.isInteger(b.total_guests) && b.total_guests >= 1)) f.add('total_guests', 'Number of guests must be 1 or more.');
    f.check();

    await db().tx(async t => {
      await lockRes(t, prop(req), req.params.id);
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      if (!['CONFIRMED', 'CHECKED_IN'].includes(r.status)) throw conflict(`A ${r.status.toLowerCase().replace('_', ' ')} reservation cannot be edited.`, 'INVALID_STATE');
      const nIn = b.check_in ?? r.check_in, nOut = b.check_out ?? r.check_out, nType = b.room_type_id ?? r.room_type_id, nGuests = b.total_guests ?? r.total_guests;
      const dateChange = nIn !== r.check_in || nOut !== r.check_out, typeChange = nType !== r.room_type_id, guestsChange = nGuests !== r.total_guests;
      const before = { check_in: r.check_in, check_out: r.check_out, room_type: r.room_type, total_guests: r.total_guests };
      let after = null;

      if (dateChange || typeChange || guestsChange) {
        if (r.status === 'CHECKED_IN' && (typeChange || nIn !== r.check_in || nOut < r.check_out))
          throw conflict('After check-in only an extension (a later check-out) or guest details can change.', 'INVALID_STATE');
        const rt = await typeOf(t.q, prop(req), nType);
        const ff = new Fields();
        if (nOut <= nIn) ff.add('check_out', 'Check-out must be after check-in.');
        if (nIn !== r.check_in && nIn < S.today()) ff.add('check_in', 'Check-in cannot be in the past.');
        if (nOut !== r.check_out && nOut <= S.today() && r.status === 'CONFIRMED') ff.add('check_out', 'Check-out must be after today.');
        if (nGuests > rt.max_guests) ff.add('total_guests', `${rt.name} allows at most ${rt.max_guests} guests.`);
        ff.check();
        const stayChange = dateChange || typeChange;
        if (stayChange && S.nightsList(nIn, nOut).length < rt.min_nights) throw bad(`${rt.name} requires at least ${rt.min_nights} nights.`, [{ field: 'check_out', message: `Minimum ${rt.min_nights} nights.` }]);

        if (r.status === 'CHECKED_IN') {
          if (nOut > r.check_out) {                                 // extension: only the new nights are priced and reserved
            await S.lockStock(t.q, r.room_type_id, r.check_out, nOut);
            await S.reserveStock(t.q, rt, r.check_out, nOut);
            if (!(await S.freeRooms(t.q, r.room_type_id, r.check_out, nOut, r.reservation_id, false)).some(x => x.room_id === r.room_id))
              throw conflict(`Room ${r.room_number} is taken for the extra nights. Move the guest first or shorten the extension.`, 'ROOM_NOT_AVAILABLE');
            const price = S.priceStay(await S.loadRules(t.q, rt.room_type_id), r.check_out, nOut);
            if (price.total === null) throw conflict('No approved rate for every extra night.', 'NO_APPROVED_RATE');
            for (const nt of price.nights) await t.q(`insert into charges(folio_id,charge_type,description,quantity,unit_price,amount,stay_date) values($1,'ROOM',$2,1,$3,$3,$4)`, [r.folio_id, `Room night ${nt.date} (${rt.name})`, nt.rate, nt.date]);
            await t.q('update reservation_rooms set rate_total=rate_total+$2 where reservation_room_id=$1', [r.reservation_room_id, price.total]);
          }
        } else if (stayChange) {                                    // CONFIRMED: release the old nights, take the new ones, price again
          await S.lockRanges(t.q, [{ typeId: r.room_type_id, from: r.check_in, to: r.check_out }, { typeId: nType, from: nIn, to: nOut }]);
          await S.releaseStock(t.q, r.room_type_id, r.check_in, r.check_out);
          await S.reserveStock(t.q, rt, nIn, nOut);
          const price = S.priceStay(await S.loadRules(t.q, rt.room_type_id), nIn, nOut);
          if (price.total === null) throw conflict('No approved rate for every night of the new stay.', 'NO_APPROVED_RATE');
          if (r.room_id && !typeChange && !(await S.freeRooms(t.q, nType, nIn, nOut, r.reservation_id, false)).some(x => x.room_id === r.room_id))
            throw conflict(`Room ${r.room_number} is not free for the new dates. Change the room first.`, 'ROOM_NOT_AVAILABLE');
          await replaceRoomCharges(t, r.folio_id, rt, price, req.user.user_id);
          await t.q('update reservation_rooms set room_type_id=$2, rate_total=$3, room_id=case when $2::uuid is distinct from room_type_id then null else room_id end where reservation_room_id=$1', [r.reservation_room_id, nType, price.total]);
        }
        const [u] = await t.q('update reservations set check_in_date=$2, check_out_date=$3, total_guests=$4 where reservation_id=$1 and status=$5 returning reservation_id', [r.reservation_id, nIn, nOut, nGuests, r.status]);
        if (!u) throw conflict('The reservation changed while you were editing. Reload and try again.', 'INVALID_STATE');
        await S.recalcPayment(t.q, r.reservation_id);
        after = { check_in: nIn, check_out: nOut, room_type: rt.name, total_guests: nGuests };
      }
      await t.q('update guests set full_name=coalesce($2,full_name), phone=coalesce($3,phone), email=coalesce($4,email) where guest_id=$1', [r.guest_id, name, phone, email]);
      await t.q('update reservations set special_requests=coalesce($2,special_requests), notes=coalesce($3,notes), estimated_arrival=coalesce($4::time,estimated_arrival) where reservation_id=$1', [r.reservation_id, requests, notes, b.estimated_arrival || null]);
      await S.audit(t.q, req.user.user_id, 'RESERVATION_UPDATED', 'reservations', r.reservation_id, after ? before : null, { ...(after || {}), ...(name || phone || email || requests || notes ? { details: true } : {}) });
    });
    res.json(await view(req, req.params.id));
  }));

  // ---------- S084 cancel, S085 no-show: guarded status change + stock back ----------
  async function leave(req, res, { to, action, needRemark, tooEarly }) {
    const b = req.body || {}, f = new Fields();
    const remark = optText(f, 'remark', b.remark, 300);
    if (needRemark && !remark) f.add('remark', 'A remark is required.');
    f.check();
    if (to === 'CANCELLED') {                                         // S175: the cancellation rule and the refund requests live in cancellation.js
      await db().tx(t => Cancellation.cancelReservation(t, prop(req), req.params.id, { userId: req.user.user_id, remark, via: 'STAFF' }));
      return res.json(await view(req, req.params.id));
    }
    await db().tx(async t => {
      await lockRes(t, prop(req), req.params.id);
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      if (r.status !== 'CONFIRMED') throw conflict(`Only a confirmed reservation can be ${to === 'NO_SHOW' ? 'marked as No-Show' : 'cancelled'}. This one is ${r.status}.`, 'INVALID_STATE');
      if (tooEarly && r.check_in > S.today()) throw conflict(`The guest is not due until ${r.check_in}. A No-Show can be recorded on the arrival date or later.`, 'INVALID_STATE');
      const [u] = await t.q('update reservations set status=$2, status_remark=$3, status_changed_at=now() where reservation_id=$1 and status=$4 returning reservation_id', [r.reservation_id, to, remark, 'CONFIRMED']);
      if (!u) throw conflict('The reservation changed while you were working. Reload and try again.', 'INVALID_STATE');
      await S.lockStock(t.q, r.room_type_id, r.check_in, r.check_out);
      await S.releaseStock(t.q, r.room_type_id, r.check_in, r.check_out);
      await t.q('update reservation_rooms set room_id=null where reservation_room_id=$1', [r.reservation_room_id]);
      await S.audit(t.q, req.user.user_id, action, 'reservations', r.reservation_id, { status: 'CONFIRMED' }, { status: to, remark });
    });
    res.json(await view(req, req.params.id));
  }
  app.post('/api/reservations/:id/cancel', ...manage, wrap((req, res) => leave(req, res, { to: 'CANCELLED', action: 'RESERVATION_CANCELLED' })));
  app.post('/api/reservations/:id/no-show', ...manage, wrap((req, res) => leave(req, res, { to: 'NO_SHOW', action: 'RESERVATION_NO_SHOW', needRemark: true, tooEarly: true })));

  // ---------- rooms: list and assign ----------
  app.get('/api/reservations/:id/free-rooms', ...operate, wrap(async (req, res) => {
    const r = await view(req, req.params.id);
    res.json(await S.freeRooms(q, r.room_type_id, r.check_in, r.check_out, r.reservation_id, false));
  }));
  app.post('/api/reservations/:id/assign-room', ...operate, wrap(async (req, res) => {
    if (!isUuid((req.body || {}).room_id)) throw bad('Choose a room.', [{ field: 'room_id', message: 'Must be a room id (UUID).' }]);
    await db().tx(async t => {
      await lockRes(t, prop(req), req.params.id);
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      if (!['CONFIRMED', 'CHECKED_IN'].includes(r.status)) throw conflict('Rooms can only be assigned to active reservations.', 'INVALID_STATE');
      // a guest already in the house moves into a room that is ready now; the room they leave goes to cleaning
      const inHouse = r.status === 'CHECKED_IN';
      const ok = (await S.freeRooms(t.q, r.room_type_id, r.check_in, r.check_out, r.reservation_id, inHouse)).find(x => x.room_id === req.body.room_id);
      if (!ok) throw conflict(inHouse ? 'That room is not ready now, is blocked, has another stay, or is a different room type.' : 'That room is not free for these dates, is blocked, or is a different room type.', 'ROOM_NOT_AVAILABLE');
      await t.q('update reservation_rooms set room_id=$2 where reservation_room_id=$1', [r.reservation_room_id, ok.room_id]);
      if (inHouse && r.room_id && r.room_id !== ok.room_id) {
        await S.moveRoom(t.q, r.room_id, 'CLEANING', req.user.user_id, 'guest moved to room ' + ok.room_number);
        await S.moveRoom(t.q, ok.room_id, 'OCCUPIED', req.user.user_id, 'guest moved in');
      }
      await S.audit(t.q, req.user.user_id, 'ROOM_ASSIGNED', 'reservations', r.reservation_id, { room: r.room_number || null }, { room: ok.room_number });
    });
    res.json(await view(req, req.params.id));
  }));

  // ---------- S086 check-in ----------
  app.post('/api/reservations/:id/check-in', ...operate, wrap(async (req, res) => {
    const want = (req.body || {}).room_id;
    if (want !== undefined && !isUuid(want)) throw bad('Invalid room.', [{ field: 'room_id', message: 'Must be a room id (UUID).' }]);
    await db().tx(async t => {
      await lockRes(t, prop(req), req.params.id);
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      if (r.status !== 'CONFIRMED') throw conflict(`Only a confirmed reservation can be checked in. This one is ${r.status}.`, 'INVALID_STATE');
      if (r.check_in > S.today()) throw conflict(`Too early: arrival is ${r.check_in}.`, 'INVALID_STATE');
      if (r.check_out <= S.today()) throw conflict(`The stay ended on ${r.check_out}. Edit the dates or mark a No-Show.`, 'INVALID_STATE');
      const ready = await S.freeRooms(t.q, r.room_type_id, r.check_in, r.check_out, r.reservation_id, true);
      const wanted = want || r.room_id;
      let room;
      if (wanted) {
        room = ready.find(x => x.room_id === wanted);
        if (!room) throw conflict(`${wanted === r.room_id && r.room_number ? 'Room ' + r.room_number : 'That room'} is not ready (cleaning, occupied, blocked, another stay, or a different room type).`, 'ROOM_NOT_AVAILABLE');
      } else {
        room = ready[0];
        if (!room) throw conflict('No available room of this type is ready for check-in.', 'ROOM_NOT_AVAILABLE');
      }
      const [rm] = await t.q('select status_id from rooms where room_id=$1 for update', [room.room_id]);        // two check-ins cannot take the same room
      if (rm.status_id !== 1) throw conflict(`Room ${room.room_number} was just taken. Choose another room.`, 'ROOM_NOT_AVAILABLE');
      const [u] = await t.q("update reservations set status='CHECKED_IN', checked_in_at=now(), status_changed_at=now() where reservation_id=$1 and status='CONFIRMED' returning reservation_id", [r.reservation_id]);
      if (!u) throw conflict('The reservation changed while you were working. Reload and try again.', 'INVALID_STATE');
      await t.q('update reservation_rooms set room_id=$2 where reservation_room_id=$1', [r.reservation_room_id, room.room_id]);
      await t.q('update rooms set status_id=2 where room_id=$1', [room.room_id]);
      await S.audit(t.q, req.user.user_id, 'CHECKED_IN', 'reservations', r.reservation_id, { status: 'CONFIRMED' }, { status: 'CHECKED_IN', room: room.room_number });
    });
    res.json(await view(req, req.params.id));
  }));

  // ---------- S087 check-out: balance zero, room becomes dirty (CLEANING), unused future nights go back ----------
  app.post('/api/reservations/:id/check-out', ...operate, wrap(async (req, res) => {
    await db().tx(async t => {
      await lockRes(t, prop(req), req.params.id);
      const r = await S.getReservation(t.q, prop(req), req.params.id);
      if (r.status !== 'CHECKED_IN') throw conflict(`Only a checked-in reservation can be checked out. This one is ${r.status}.`, 'INVALID_STATE');
      if (r.balance > 0.001) throw conflict(`Outstanding balance of ${r.balance.toFixed(2)}. Record payment before check-out.`, 'BALANCE_OUTSTANDING');
      const [u] = await t.q("update reservations set status='CHECKED_OUT', checked_out_at=now(), status_changed_at=now() where reservation_id=$1 and status='CHECKED_IN' returning reservation_id", [r.reservation_id]);
      if (!u) throw conflict('The reservation changed while you were working. Reload and try again.', 'INVALID_STATE');
      const cfg = await S.settings(t.q, prop(req)), after = cfg.post_stay_room_status;              // FR-11: the configured post-stay status (CLEANING unless changed)
      await S.moveRoom(t.q, r.room_id, 'CLEANING', req.user.user_id, 'check-out');                 // an occupied room first becomes dirty, then (if configured) ready
      if (after === 'AVAILABLE') await S.moveRoom(t.q, r.room_id, 'AVAILABLE', req.user.user_id, 'check-out, no cleaning step configured');
      if (after === 'CLEANING') await t.q("insert into housekeeping_tasks(room_id,reservation_id,task_type,created_by) values($1,$2,'CHECKOUT_CLEAN',$3)", [r.room_id, r.reservation_id, req.user.user_id]);
      await t.q('update folios set closed_at=now() where folio_id=$1', [r.folio_id]);
      let early = 0;
      if (r.check_out > S.today()) { await S.lockStock(t.q, r.room_type_id, S.today(), r.check_out); early = await S.releaseStock(t.q, r.room_type_id, S.today(), r.check_out); }
      await S.audit(t.q, req.user.user_id, 'CHECKED_OUT', 'reservations', r.reservation_id, { status: 'CHECKED_IN' }, { status: 'CHECKED_OUT', room_status: after, nights_returned: early });
    });
    res.json(await view(req, req.params.id));
  }));
};
