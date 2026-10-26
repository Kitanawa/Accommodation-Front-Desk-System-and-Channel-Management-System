// M09 (S060 to S062, S067, S069): room categories, room types, physical rooms and add-ons.
// Everything is limited to the caller's property. A record of another property looks like a missing one (404).
const S = require('./service');
const P = require('./permissions');
const { bad, notFound, conflict, Fields, isUuid } = require('./errors');

const text = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const money2 = v => v !== '' && v !== null && typeof v !== 'boolean' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 9999999.99 && Math.round(Number(v) * 100) / 100 === Number(v);
const URL_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/;

// S061: facilities are a list of short names, photos are metadata only (the picture itself is stored elsewhere).
function checkFacilities(v, f) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 40 || !v.every(x => text(x, 1, 60))) { f.add('facilities', 'Give a list of up to 40 facility names, each 1 to 60 characters.'); return null; }
  const seen = new Set(), out = [];
  for (const x of v.map(x => x.trim())) if (!seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); out.push(x); }
  return out;
}
function checkPhotos(v, f) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 20) { f.add('photos', 'Give a list of up to 20 photos.'); return null; }
  const out = [];
  v.forEach((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return f.add(`photos[${i}]`, 'Each photo is an object with a url.');
    if (typeof p.url !== 'string' || p.url.length > 500 || !URL_RE.test(p.url)) f.add(`photos[${i}].url`, 'Must be an http(s) address or a path starting with /.');
    if (p.caption !== undefined && p.caption !== null && !text(String(p.caption), 0, 150)) f.add(`photos[${i}].caption`, 'At most 150 characters.');
    if (p.alt !== undefined && p.alt !== null && !text(String(p.alt), 0, 150)) f.add(`photos[${i}].alt`, 'At most 150 characters.');
    out.push({ url: p.url, caption: p.caption ?? null, alt: p.alt ?? null, sort_order: Number.isInteger(p.sort_order) ? p.sort_order : i });
  });
  if (!f.any && new Set(out.map(p => p.url)).size !== out.length) f.add('photos', 'The same photo is listed twice.');
  return out;
}

module.exports = function mountCatalog(app, { getDb, auth, need, wrap, validateRate, checkCurrency }) {
  const db = () => getDb(), q = (s, p) => db().q(s, p), prop = req => req.user.property_id;
  const canAll = req => P.can(req.user, 'rates.view_all');
  const audit = (run, req, action, type, id, o, n) => S.audit(run, req.user.user_id, action, type, id, o, n);

  // ---------- S060 room categories ----------
  const catRow = async (run, id, propertyId) => (await run('select category_id, name from room_categories where category_id=$1 and property_id=$2', [id, propertyId]))[0];
  app.get('/api/room-categories', auth, need('catalog.view'), wrap(async (req, res) => res.json(await q(
    `select c.category_id, c.name, (select count(*) from room_types t where t.category_id=c.category_id)::int room_type_count
     from room_categories c where c.property_id=$1 order by c.name`, [prop(req)]))));
  app.post('/api/room-categories', auth, need('catalog.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields();
    if (!text(b.name, 2, 80)) f.add('name', 'Name must be 2 to 80 characters.');
    f.check();
    const name = b.name.trim();
    const [dup] = await q('select 1 x from room_categories where property_id=$1 and lower(name)=lower($2)', [prop(req), name]);
    if (dup) throw conflict('A room category with this name already exists.', 'CONFLICT', [{ field: 'name', message: 'Already in use (upper and lower case are the same).' }]);
    const [c] = await q('insert into room_categories(property_id,name) values($1,$2) returning category_id', [prop(req), name]);
    await audit(q, req, 'ROOM_CATEGORY_CREATED', 'room_categories', c.category_id, null, { name });
    res.status(201).json({ category_id: c.category_id, name, room_type_count: 0 });
  }));
  app.patch('/api/room-categories/:id', auth, need('catalog.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), cur = await catRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Room category not found.');
    if (!text(b.name, 2, 80)) f.add('name', 'Name must be 2 to 80 characters.');
    f.check();
    const name = b.name.trim();
    const [dup] = await q('select 1 x from room_categories where property_id=$1 and lower(name)=lower($2) and category_id<>$3', [prop(req), name, cur.category_id]);
    if (dup) throw conflict('A room category with this name already exists.', 'CONFLICT', [{ field: 'name', message: 'Already in use (upper and lower case are the same).' }]);
    await q('update room_categories set name=$2 where category_id=$1', [cur.category_id, name]);
    await audit(q, req, 'ROOM_CATEGORY_RENAMED', 'room_categories', cur.category_id, { name: cur.name }, { name });
    res.json({ category_id: cur.category_id, name });
  }));
  app.delete('/api/room-categories/:id', auth, need('catalog.manage'), wrap(async (req, res) => {
    const cur = await catRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Room category not found.');
    const [n] = await q('select count(*)::int n from room_types where category_id=$1', [cur.category_id]);
    if (n.n) throw conflict(`This category still has ${n.n} room type(s). Move or remove them first.`, 'INVALID_STATE');
    await q('delete from room_categories where category_id=$1', [cur.category_id]);
    await audit(q, req, 'ROOM_CATEGORY_DELETED', 'room_categories', cur.category_id, { name: cur.name }, null);
    res.json({ ok: true });
  }));

  // ---------- S061 room types (details, facilities, photo metadata) and S067 combined submission ----------
  const typeCols = `t.room_type_id, t.category_id, c.name category, t.name, t.max_guests, t.min_nights, t.description, t.facilities, t.photos, t.layout_info, t.approval_status`;
  const typeFrom = `from room_types t join room_categories c using(category_id)`;
  const typeRow = async (run, id, propertyId) => (await run(`select ${typeCols} ${typeFrom} where t.room_type_id=$1 and c.property_id=$2`, [id, propertyId]))[0];
  app.get('/api/room-types', auth, need('catalog.view'), wrap(async (req, res) => res.json(await q(
    `select ${typeCols} ${typeFrom} where c.property_id=$1 ${canAll(req) ? '' : "and t.approval_status='APPROVED'"} order by t.name`, [prop(req)]))));
  app.get('/api/room-types/:id', auth, need('catalog.view'), wrap(async (req, res) => {
    const t = await typeRow(q, req.params.id, prop(req));
    if (!t || (t.approval_status !== 'APPROVED' && !canAll(req))) throw notFound('Room type not found.');
    t.rates = await q(`select rate_rule_id, rule_type, rate_amount::float8 rate_amount, date_from::text date_from, date_to::text date_to, selected_days, specific_date::text specific_date,
        priority, approval_status, supersedes_id, effective_from::text effective_from, valid_until::text valid_until
      from rate_rules where room_type_id=$1 ${canAll(req) ? '' : "and approval_status='APPROVED'"} order by rule_type, created_at`, [t.room_type_id]);
    t.rooms = await q('select room_id, room_number, floor from rooms where room_type_id=$1 order by room_number', [t.room_type_id]);
    res.json(t);
  }));

  function typeFields(b, f, partial) {
    const out = {}, has = k => b[k] !== undefined;
    if (!partial || has('name')) { if (!text(b.name, 2, 100)) f.add('name', 'Name must be 2 to 100 characters.'); else out.name = b.name.trim(); }
    if (!partial || has('category_id')) { if (!isUuid(b.category_id)) f.add('category_id', 'Choose a room category.'); else out.category_id = b.category_id; }
    if (!partial || has('max_guests')) { if (!Number.isInteger(b.max_guests) || b.max_guests < 1 || b.max_guests > 20) f.add('max_guests', 'Maximum guests must be a whole number from 1 to 20.'); else out.max_guests = b.max_guests; }
    if (has('min_nights')) { if (!Number.isInteger(b.min_nights) || b.min_nights < 1 || b.min_nights > 365) f.add('min_nights', 'Minimum nights must be a whole number from 1 to 365.'); else out.min_nights = b.min_nights; }
    if (has('description')) { if (b.description !== null && !text(String(b.description), 0, 2000)) f.add('description', 'At most 2000 characters.'); else out.description = b.description === null ? null : String(b.description).trim() || null; }
    if (has('layout_info')) { if (b.layout_info !== null && !text(String(b.layout_info), 0, 500)) f.add('layout_info', 'At most 500 characters.'); else out.layout_info = b.layout_info === null ? null : String(b.layout_info).trim() || null; }
    if (has('facilities')) out.facilities = b.facilities === null ? null : checkFacilities(b.facilities, f);
    if (has('photos')) out.photos = b.photos === null ? null : checkPhotos(b.photos, f);
    return out;
  }
  async function typeNameFree(run, categoryId, name, exceptId) {
    const [d] = await run('select 1 x from room_types where category_id=$1 and lower(name)=lower($2) and ($3::uuid is null or room_type_id<>$3)', [categoryId, name, exceptId || null]);
    if (d) throw conflict('This category already has a room type with this name.', 'CONFLICT', [{ field: 'name', message: 'Already in use in this category (upper and lower case are the same).' }]);
  }
  // S067: one request submits the room type and its rates. Everything starts PENDING and is approved together.
  app.post('/api/room-types', auth, need('catalog.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), v = typeFields(b, f, false);
    const rates = b.rates === undefined ? [] : b.rates;
    if (!Array.isArray(rates) || rates.length > 50) f.add('rates', 'Give a list of up to 50 rates.');
    else {
      if (rates.length && rates.filter(r => r && r.rule_type === 'BASE').length !== 1) f.add('rates', 'Include exactly one BASE rate.');
      rates.forEach((r, i) => { if (!r || typeof r !== 'object') return f.add(`rates[${i}]`, 'Each rate is an object.'); const sub = validateRate({ ...r, room_type_id: '00000000-0000-4000-8000-000000000000' }); sub.list.forEach(e => f.add(`rates[${i}].${e.field}`, e.message)); });
    }
    f.check();
    if (!(await catRow(q, v.category_id, prop(req)))) throw bad('Please correct the fields listed.', [{ field: 'category_id', message: 'No such room category in your property.' }]);
    const created = await db().tx(async t => {
      await typeNameFree(t.q, v.category_id, v.name);
      const [row] = await t.q(`insert into room_types(category_id,name,max_guests,min_nights,description,facilities,photos,layout_info,approval_status)
        values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'PENDING') returning room_type_id`, [v.category_id, v.name, v.max_guests, v.min_nights ?? 1, v.description ?? null,
        v.facilities ? JSON.stringify(v.facilities) : null, v.photos ? JSON.stringify(v.photos) : null, v.layout_info ?? null]);
      for (const r of rates) {
        await checkCurrency(t.q, prop(req), r);
        await t.q(`insert into rate_rules(room_type_id,rule_type,rate_amount,date_from,date_to,selected_days,specific_date,priority) values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [row.room_type_id, r.rule_type, r.rate_amount, r.date_from ?? null, r.date_to ?? null, Array.isArray(r.selected_days) && r.selected_days.length ? [...r.selected_days].sort((x, y) => x - y) : null, r.specific_date ?? null, r.priority ?? null]);
      }
      await audit(t.q, req, 'ROOM_TYPE_SUBMITTED', 'room_types', row.room_type_id, null, { name: v.name, category_id: v.category_id, rates: rates.length, approval_status: 'PENDING' });
      return row.room_type_id;
    });
    res.status(201).json({ room_type_id: created, approval_status: 'PENDING', rates_submitted: rates.length });
  }));
  app.patch('/api/room-types/:id', auth, need('catalog.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), cur = await typeRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Room type not found.');
    const v = typeFields(b, f, true);
    if (!Object.keys(b).length) f.add('body', 'Send at least one field to change.');
    f.check();
    if (v.category_id && !(await catRow(q, v.category_id, prop(req)))) throw bad('Please correct the fields listed.', [{ field: 'category_id', message: 'No such room category in your property.' }]);
    await db().tx(async t => {
      await typeNameFree(t.q, v.category_id || cur.category_id, v.name || cur.name, cur.room_type_id);
      const sets = [], vals = [cur.room_type_id];
      for (const [k, val] of Object.entries(v)) { vals.push(['facilities', 'photos'].includes(k) ? (val === null ? null : JSON.stringify(val)) : val); sets.push(`${k}=$${vals.length}${['facilities', 'photos'].includes(k) ? '::jsonb' : ''}`); }
      if (sets.length) await t.q(`update room_types set ${sets.join(', ')} where room_type_id=$1`, vals);
      await audit(t.q, req, 'ROOM_TYPE_UPDATED', 'room_types', cur.room_type_id, Object.fromEntries(Object.keys(v).map(k => [k, cur[k]])), v);
    });
    res.json(await typeRow(q, cur.room_type_id, prop(req)));
  }));
  // S067: PENDING -> APPROVED. Approving a room type approves its pending rates in the same step.
  app.post('/api/room-types/:id/approve', auth, need('rates.approve'), wrap(async (req, res) => {
    const out = await db().tx(async t => {
      const cur = await typeRow(t.q, req.params.id, prop(req));
      if (!cur) throw notFound('Room type not found.');
      if (cur.approval_status === 'APPROVED') throw conflict('Already approved.', 'INVALID_STATE');
      const [base] = await t.q("select 1 x from rate_rules where room_type_id=$1 and rule_type='BASE' and approval_status='PENDING' and supersedes_id is null", [cur.room_type_id]);
      if (!base) throw conflict('Add a Base Rate before approving this room type.', 'INVALID_STATE');
      const rates = await t.q("update rate_rules set approval_status='APPROVED' where room_type_id=$1 and approval_status='PENDING' and supersedes_id is null returning rate_rule_id", [cur.room_type_id]);
      await t.q("update room_types set approval_status='APPROVED' where room_type_id=$1", [cur.room_type_id]);
      await audit(t.q, req, 'ROOM_TYPE_APPROVED', 'room_types', cur.room_type_id, { approval_status: 'PENDING' }, { approval_status: 'APPROVED', rates_approved: rates.length });
      return { rates_approved: rates.length };
    });
    res.json({ ok: true, approval_status: 'APPROVED', ...out });
  }));
  // A PENDING room type that was never sold can be withdrawn together with its pending rates.
  app.delete('/api/room-types/:id', auth, need('catalog.manage'), wrap(async (req, res) => {
    await db().tx(async t => {
      const cur = await typeRow(t.q, req.params.id, prop(req));
      if (!cur) throw notFound('Room type not found.');
      if (cur.approval_status !== 'PENDING') throw conflict('Only a room type that is still pending can be withdrawn.', 'INVALID_STATE');
      const [used] = await t.q('select 1 x from reservation_rooms where room_type_id=$1 limit 1', [cur.room_type_id]);
      if (used) throw conflict('This room type has reservations.', 'INVALID_STATE');
      await t.q('delete from rate_rules where room_type_id=$1', [cur.room_type_id]);
      await t.q('delete from room_stock where room_type_id=$1', [cur.room_type_id]);
      await t.q('delete from rooms where room_type_id=$1', [cur.room_type_id]);
      await t.q('delete from room_types where room_type_id=$1', [cur.room_type_id]);
      await audit(t.q, req, 'ROOM_TYPE_WITHDRAWN', 'room_types', cur.room_type_id, { name: cur.name }, null);
    });
    res.json({ ok: true });
  }));

  // ---------- S062 physical rooms ----------
  const roomRow = async (run, id, propertyId) => (await run(`select r.room_id, r.room_number, r.floor, r.room_type_id, r.status_id from rooms r join room_types t using(room_type_id)
    join room_categories c using(category_id) where r.room_id=$1 and c.property_id=$2`, [id, propertyId]))[0];
  function roomFields(b, f, partial) {
    const out = {}, has = k => b[k] !== undefined;
    if (!partial || has('room_number')) { if (typeof b.room_number !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,9}$/.test(b.room_number.trim())) f.add('room_number', 'Room number is 1 to 10 letters, digits or hyphens.'); else out.room_number = b.room_number.trim(); }
    if (has('floor')) { if (b.floor !== null && (!Number.isInteger(b.floor) || b.floor < -5 || b.floor > 200)) f.add('floor', 'Floor must be a whole number from -5 to 200.'); else out.floor = b.floor; }
    if (!partial || has('room_type_id')) { if (!isUuid(b.room_type_id)) f.add('room_type_id', 'Choose a room type.'); else out.room_type_id = b.room_type_id; }
    return out;
  }
  const numberFree = async (run, number, exceptId) => {
    const [d] = await run('select 1 x from rooms where lower(room_number)=lower($1) and ($2::uuid is null or room_id<>$2)', [number, exceptId || null]);
    if (d) throw conflict('This room number is already used.', 'CONFLICT', [{ field: 'room_number', message: 'Already in use (upper and lower case are the same).' }]);
  };
  app.post('/api/rooms', auth, need('catalog.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), v = roomFields(b, f, false); f.check();
    if (!(await typeRow(q, v.room_type_id, prop(req)))) throw bad('Please correct the fields listed.', [{ field: 'room_type_id', message: 'No such room type in your property.' }]);
    await numberFree(q, v.room_number);
    const [r] = await q('insert into rooms(room_type_id,room_number,floor) values($1,$2,$3) returning room_id', [v.room_type_id, v.room_number, v.floor ?? null]);
    await audit(q, req, 'ROOM_CREATED', 'rooms', r.room_id, null, v);
    res.status(201).json({ room_id: r.room_id, ...v, floor: v.floor ?? null, status: 'AVAILABLE' });
  }));
  app.patch('/api/rooms/:id', auth, need('catalog.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), cur = await roomRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Room not found.');
    const v = roomFields(b, f, true);
    if (!Object.keys(b).length) f.add('body', 'Send at least one field to change.');
    f.check();
    if (v.room_type_id && v.room_type_id !== cur.room_type_id) {
      if (!(await typeRow(q, v.room_type_id, prop(req)))) throw bad('Please correct the fields listed.', [{ field: 'room_type_id', message: 'No such room type in your property.' }]);
      const [held] = await q("select 1 x from reservation_rooms rr join reservations x using(reservation_id) where rr.room_id=$1 and x.status in ('CONFIRMED','CHECKED_IN')", [cur.room_id]);
      if (held) throw conflict('This room is assigned to a current or coming reservation, so its room type cannot change.', 'INVALID_STATE');
    }
    if (v.room_number) await numberFree(q, v.room_number, cur.room_id);
    const sets = [], vals = [cur.room_id];
    for (const [k, val] of Object.entries(v)) { vals.push(val); sets.push(`${k}=$${vals.length}`); }
    await q(`update rooms set ${sets.join(', ')} where room_id=$1`, vals);
    await audit(q, req, 'ROOM_UPDATED', 'rooms', cur.room_id, Object.fromEntries(Object.keys(v).map(k => [k, cur[k]])), v);
    res.json({ room_id: cur.room_id, room_number: cur.room_number, floor: cur.floor, room_type_id: cur.room_type_id, ...v });
  }));
  app.delete('/api/rooms/:id', auth, need('catalog.manage'), wrap(async (req, res) => {
    const cur = await roomRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Room not found.');
    const [used] = await q('select 1 x from reservation_rooms where room_id=$1 limit 1', [cur.room_id]);
    if (used || cur.status_id === 2) throw conflict('This room has stay history, so it cannot be deleted. Set it to Maintenance/Blocked instead.', 'INVALID_STATE');
    await q('delete from rooms where room_id=$1', [cur.room_id]);
    await audit(q, req, 'ROOM_DELETED', 'rooms', cur.room_id, { room_number: cur.room_number }, null);
    res.json({ ok: true });
  }));

  // ---------- S069 add-ons ----------
  const UNITS = ['PER_STAY', 'PER_NIGHT', 'PER_GUEST'];
  const addCols = `a.add_on_id, a.name, a.description, a.pricing_unit, a.unit_price::float8 unit_price, a.approval_status, a.is_active`;
  const addRow = async (run, id, propertyId) => (await run(`select ${addCols}, a.pending_unit_price::float8 pending_unit_price from add_ons a where a.add_on_id=$1 and a.property_id=$2`, [id, propertyId]))[0];
  app.get('/api/add-ons', auth, need('catalog.view'), wrap(async (req, res) => {
    const all = canAll(req);
    res.json(await q(`select ${addCols}${all ? ', a.pending_unit_price::float8 pending_unit_price' : ''} from add_ons a where a.property_id=$1 ${all ? '' : "and a.approval_status='APPROVED' and a.is_active"} order by a.name`, [prop(req)]));
  }));
  function addFields(b, f, partial) {
    const out = {}, has = k => b[k] !== undefined;
    if (!partial || has('name')) { if (!text(b.name, 2, 80)) f.add('name', 'Name must be 2 to 80 characters.'); else out.name = b.name.trim(); }
    if (has('description')) { if (b.description !== null && !text(String(b.description), 0, 300)) f.add('description', 'At most 300 characters.'); else out.description = b.description === null ? null : String(b.description).trim() || null; }
    if (has('pricing_unit')) { if (!UNITS.includes(b.pricing_unit)) f.add('pricing_unit', `Must be one of ${UNITS.join(', ')}.`); else out.pricing_unit = b.pricing_unit; }
    if (!partial || has('unit_price')) { if (!money2(b.unit_price)) f.add('unit_price', 'Price must be 0 to 9,999,999.99 with at most 2 decimal places.'); else out.unit_price = Number(b.unit_price); }
    if (has('is_active')) { if (typeof b.is_active !== 'boolean') f.add('is_active', 'Must be true or false.'); else out.is_active = b.is_active; }
    return out;
  }
  const addNameFree = async (run, propertyId, name, exceptId) => {
    const [d] = await run('select 1 x from add_ons where property_id=$1 and lower(name)=lower($2) and ($3::uuid is null or add_on_id<>$3)', [propertyId, name, exceptId || null]);
    if (d) throw conflict('An add-on with this name already exists.', 'CONFLICT', [{ field: 'name', message: 'Already in use (upper and lower case are the same).' }]);
  };
  app.post('/api/add-ons', auth, need('rates.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), v = addFields(b, f, false); f.check();
    await addNameFree(q, prop(req), v.name);
    const [a] = await q('insert into add_ons(property_id,name,description,pricing_unit,unit_price,is_active) values($1,$2,$3,$4,$5,$6) returning add_on_id',
      [prop(req), v.name, v.description ?? null, v.pricing_unit || 'PER_STAY', v.unit_price, v.is_active ?? true]);
    await audit(q, req, 'ADD_ON_CREATED', 'add_ons', a.add_on_id, null, { ...v, approval_status: 'PENDING' });
    res.status(201).json(await addRow(q, a.add_on_id, prop(req)));
  }));
  // The approved price never changes by itself. A new price on an approved add-on waits as pending_unit_price until it is approved.
  app.patch('/api/add-ons/:id', auth, need('rates.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), cur = await addRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Add-on not found.');
    const v = addFields(b, f, true);
    if (!Object.keys(b).length) f.add('body', 'Send at least one field to change.');
    if (v.pricing_unit && v.pricing_unit !== cur.pricing_unit && cur.approval_status === 'APPROVED') f.add('pricing_unit', 'The pricing unit of an approved add-on cannot change. Create a new add-on instead.');
    f.check();
    if (v.name) await addNameFree(q, prop(req), v.name, cur.add_on_id);
    const sets = [], vals = [cur.add_on_id];
    let pending = undefined;
    for (const [k, val] of Object.entries(v)) {
      if (k === 'unit_price' && cur.approval_status === 'APPROVED') { pending = val === cur.unit_price ? null : val; continue; }
      vals.push(val); sets.push(`${k}=$${vals.length}`);
    }
    if (pending !== undefined) { vals.push(pending); sets.push(`pending_unit_price=$${vals.length}`); }
    if (sets.length) await q(`update add_ons set ${sets.join(', ')} where add_on_id=$1`, vals);
    await audit(q, req, pending !== undefined && pending !== null ? 'ADD_ON_PRICE_CHANGE_SUBMITTED' : 'ADD_ON_UPDATED', 'add_ons', cur.add_on_id, Object.fromEntries(Object.keys(v).map(k => [k, cur[k]])), v);
    res.json(await addRow(q, cur.add_on_id, prop(req)));
  }));
  app.post('/api/add-ons/:id/approve', auth, need('rates.approve'), wrap(async (req, res) => {
    const out = await db().tx(async t => {
      const cur = await addRow(t.q, req.params.id, prop(req));
      if (!cur) throw notFound('Add-on not found.');
      if (cur.approval_status === 'PENDING') {
        await t.q("update add_ons set approval_status='APPROVED' where add_on_id=$1", [cur.add_on_id]);
        await audit(t.q, req, 'ADD_ON_APPROVED', 'add_ons', cur.add_on_id, { approval_status: 'PENDING' }, { approval_status: 'APPROVED' });
      } else if (cur.pending_unit_price !== null) {
        await t.q('update add_ons set unit_price=pending_unit_price, pending_unit_price=null where add_on_id=$1', [cur.add_on_id]);
        await audit(t.q, req, 'ADD_ON_PRICE_APPROVED', 'add_ons', cur.add_on_id, { unit_price: cur.unit_price }, { unit_price: cur.pending_unit_price });
      } else throw conflict('Nothing is waiting for approval.', 'INVALID_STATE');
      return addRow(t.q, cur.add_on_id, prop(req));
    });
    res.json(out);
  }));
  app.delete('/api/add-ons/:id', auth, need('rates.manage'), wrap(async (req, res) => {
    const cur = await addRow(q, req.params.id, prop(req));
    if (!cur) throw notFound('Add-on not found.');
    if (cur.approval_status !== 'PENDING') throw conflict('An approved add-on cannot be deleted. Set is_active to false instead.', 'INVALID_STATE');
    await q('delete from add_ons where add_on_id=$1', [cur.add_on_id]);
    await audit(q, req, 'ADD_ON_WITHDRAWN', 'add_ons', cur.add_on_id, { name: cur.name }, null);
    res.json({ ok: true });
  }));
};
