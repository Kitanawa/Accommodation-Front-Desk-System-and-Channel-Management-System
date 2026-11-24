// M13 operations (S103 to S106): housekeeping, maintenance and room blocking, property policies, notification preferences and logs, reports.
const S = require('./service');
const P = require('./permissions');
const { bad, notFound, conflict, Fields, isUuid } = require('./errors');

const TASK_TYPES = ['CHECKOUT_CLEAN', 'DAILY_CLEAN', 'INSPECTION'], PRIORITIES = ['NORMAL', 'HIGH'];
const CHANNELS = ['IN_APP', 'EMAIL'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = col => `((${col} at time zone 'UTC') + interval '8 hours')::date`;      // property days are UTC+8

module.exports = function mount(app, { getDb, auth, need, wrap }) {
  const db = () => getDb();
  const q = (s, p) => db().q(s, p);
  const prop = req => req.user.property_id;
  const money = S.money;

  async function roomOf(qq, req, id) {
    const [r] = await qq(`select r.room_id, r.room_number, st.code status from rooms r join room_types t using(room_type_id) join room_categories c using(category_id)
      join room_statuses st on st.status_id=r.status_id where r.room_id=$1 and c.property_id=$2`, [id, prop(req)]);
    if (!r) throw notFound('Room not found.');
    return r;
  }
  const range = (Q, f, maxDays = 366) => {
    if (!S.isDate(Q.from)) f.add('from', 'Must be a date (YYYY-MM-DD).');
    if (!S.isDate(Q.to)) f.add('to', 'Must be a date (YYYY-MM-DD).');
    if (!f.any && Q.to < Q.from) f.add('to', 'Must not be before from.');
    if (!f.any && S.nightsList(Q.from, S.addDays(Q.to, 1)).length > maxDays) f.add('to', `At most ${maxDays} days.`);
    f.check();
  };

  // ---------- S105 property policies ----------
  app.get('/api/settings', auth, need('settings.view'), wrap(async (req, res) => res.json(await S.settings(q, prop(req)))));
  app.patch('/api/settings', auth, need('settings.manage'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), set = {};
    if (b.tax_name !== undefined) { if (b.tax_name === null || b.tax_name === '') set.tax_name = null; else if (typeof b.tax_name !== 'string' || b.tax_name.trim().length > 30) f.add('tax_name', 'At most 30 characters.'); else set.tax_name = b.tax_name.trim(); }
    if (b.tax_rate_pct !== undefined) { const v = Number(b.tax_rate_pct); if (b.tax_rate_pct === '' || !(v >= 0 && v <= 100) || Math.abs(money(v) - v) > 1e-9) f.add('tax_rate_pct', 'A percentage from 0 to 100 with at most 2 decimals.'); else set.tax_rate_pct = v; }
    for (const k of ['check_in_time', 'check_out_time']) if (b[k] !== undefined) { if (!TIME_RE.test(b[k])) f.add(k, 'Time as HH:MM (24 hours).'); else set[k] = b[k]; }
    if (b.cancellation_policy !== undefined) { if (b.cancellation_policy === null || b.cancellation_policy === '') set.cancellation_policy = null; else if (typeof b.cancellation_policy !== 'string' || b.cancellation_policy.length > 1000) f.add('cancellation_policy', 'At most 1000 characters.'); else set.cancellation_policy = b.cancellation_policy.trim(); }
    if (b.hold_minutes !== undefined) { if (!Number.isInteger(b.hold_minutes) || b.hold_minutes < 1 || b.hold_minutes > 60) f.add('hold_minutes', 'Whole number of minutes from 1 to 60.'); else set.hold_minutes = b.hold_minutes; }
    if (b.online_deposit_pct !== undefined) { const v = Number(b.online_deposit_pct); if (b.online_deposit_pct === '' || b.online_deposit_pct === null || !(v > 0 && v <= 100) || Math.abs(money(v) - v) > 1e-9) f.add('online_deposit_pct', 'A percentage above 0 and up to 100 with at most 2 decimals.'); else set.online_deposit_pct = v; }
    if (b.free_cancellation_hours !== undefined) { if (!Number.isInteger(b.free_cancellation_hours) || b.free_cancellation_hours < 0 || b.free_cancellation_hours > 720) f.add('free_cancellation_hours', 'Whole number of hours from 0 to 720.'); else set.free_cancellation_hours = b.free_cancellation_hours; }
    if (b.late_cancel_fee_pct !== undefined) { const v = Number(b.late_cancel_fee_pct); if (b.late_cancel_fee_pct === '' || b.late_cancel_fee_pct === null || !(v >= 0 && v <= 100) || Math.abs(money(v) - v) > 1e-9) f.add('late_cancel_fee_pct', 'A percentage from 0 to 100 with at most 2 decimals.'); else set.late_cancel_fee_pct = v; }
    if (b.post_stay_room_status !== undefined) { if (!['CLEANING', 'AVAILABLE'].includes(b.post_stay_room_status)) f.add('post_stay_room_status', 'Must be CLEANING or AVAILABLE.'); else set.post_stay_room_status = b.post_stay_room_status; }
    // property details: name and address live on properties, contact and logo with the settings
    const propSet = {};
    if (b.property_name !== undefined) { if (typeof b.property_name !== 'string' || b.property_name.trim().length < 2 || b.property_name.trim().length > 120) f.add('property_name', '2 to 120 characters.'); else propSet.name = b.property_name.trim(); }
    if (b.address !== undefined) { if (b.address !== null && (typeof b.address !== 'string' || b.address.length > 200)) f.add('address', 'At most 200 characters.'); else propSet.address = b.address ? b.address.trim() : null; }
    if (b.contact_email !== undefined) { if (b.contact_email === null || b.contact_email === '') set.contact_email = null; else if (typeof b.contact_email !== 'string' || b.contact_email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contact_email)) f.add('contact_email', 'Enter a valid e-mail address.'); else set.contact_email = b.contact_email.trim(); }
    if (b.contact_phone !== undefined) { if (b.contact_phone === null || b.contact_phone === '') set.contact_phone = null; else if (typeof b.contact_phone !== 'string' || b.contact_phone.length > 30) f.add('contact_phone', 'At most 30 characters.'); else set.contact_phone = b.contact_phone.trim(); }
    if (b.logo_data_url !== undefined) { if (b.logo_data_url === null || b.logo_data_url === '') set.logo_data_url = null; else if (typeof b.logo_data_url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.logo_data_url) || b.logo_data_url.length > 3000000) f.add('logo_data_url', 'A PNG, JPG or WebP picture under 2 MB.'); else set.logo_data_url = b.logo_data_url; }
    if (!f.any && !Object.keys(set).length && !Object.keys(propSet).length) f.add('settings', 'Send at least one setting to change.');
    f.check();
    const old = await S.settings(q, prop(req)), keys = Object.keys(set);
    await db().tx(async t => {
      if (keys.length) await t.q(`update property_settings set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where property_id=$1`, [prop(req), ...keys.map(k => set[k])]);
      const pk = Object.keys(propSet);
      if (pk.length) await t.q(`update properties set ${pk.map((k, i) => `${k}=$${i + 2}`).join(', ')} where property_id=$1`, [prop(req), ...pk.map(k => propSet[k])]);
      const shown = { ...set, ...Object.fromEntries(pk.map(k => [k === 'name' ? 'property_name' : k, propSet[k]])) };
      if ('logo_data_url' in shown) shown.logo_data_url = shown.logo_data_url ? '(picture)' : null;
      await S.audit(t.q, req.user.user_id, 'SETTINGS_CHANGED', 'properties', prop(req), Object.fromEntries(Object.keys(shown).map(k => [k, k === 'logo_data_url' ? (old.logo_data_url ? '(picture)' : null) : old[k]])), shown);
    });
    res.json(await S.settings(q, prop(req)));
  }));

  // ---------- S105 notification preferences, inbox and delivery logs ----------
  app.get('/api/notification-events', auth, wrap(async (req, res) => res.json(Object.entries(S.EVENTS).map(([event_code, e]) => ({ event_code, description: e.text, default_channels: ['IN_APP'] })))));
  app.get('/api/me/notification-preferences', auth, wrap(async (req, res) => {
    const own = await q('select event_code, channel, enabled from notification_preferences where user_id=$1', [req.user.user_id]);
    res.json(Object.keys(S.EVENTS).flatMap(event_code => CHANNELS.map(channel => {
      const p = own.find(x => x.event_code === event_code && x.channel === channel);
      return { event_code, channel, enabled: p ? p.enabled : channel === 'IN_APP', is_default: !p };
    })));
  }));
  app.put('/api/me/notification-preferences', auth, wrap(async (req, res) => {
    const list = (req.body || {}).preferences, f = new Fields();
    if (!Array.isArray(list) || !list.length || list.length > 20) f.add('preferences', 'Send a list of 1 to 20 preferences.');
    else list.forEach((p, i) => {
      if (!S.EVENTS[p && p.event_code]) f.add(`preferences[${i}].event_code`, 'Unknown event.');
      if (!CHANNELS.includes(p && p.channel)) f.add(`preferences[${i}].channel`, 'Must be IN_APP or EMAIL.');
      if (typeof (p && p.enabled) !== 'boolean') f.add(`preferences[${i}].enabled`, 'Must be true or false.');
    });
    f.check();
    await db().tx(async t => { for (const p of list) await t.q(`insert into notification_preferences(user_id,event_code,channel,enabled) values($1,$2,$3,$4)
      on conflict (user_id,event_code,channel) do update set enabled=excluded.enabled`, [req.user.user_id, p.event_code, p.channel, p.enabled]); });
    res.json({ ok: true });
  }));
  app.get('/api/me/notifications', auth, wrap(async (req, res) => res.json(await q(`select log_id, event_code, subject, payload, created_at, read_at from notification_logs
    where recipient_user_id=$1 and channel='IN_APP' ${req.query.unread === 'true' ? 'and read_at is null' : ''} order by created_at desc limit 100`, [req.user.user_id]))));
  app.post('/api/me/notifications/:id/read', auth, wrap(async (req, res) => {
    const [n] = await q('update notification_logs set read_at=coalesce(read_at,now()) where log_id=$1 and recipient_user_id=$2 returning log_id', [req.params.id, req.user.user_id]);
    if (!n) throw notFound('Notification not found.');
    res.json({ ok: true });
  }));
  app.get('/api/notifications/logs', auth, need('reports.full'), wrap(async (req, res) => {
    const Q = req.query, f = new Fields(), params = [prop(req)], where = ['l.property_id=$1'];
    const add = (c, v) => { params.push(v); where.push(c.replace('?', '$' + params.length)); };
    if (Q.event_code) { if (!S.EVENTS[Q.event_code]) f.add('event_code', 'Unknown event.'); else add('l.event_code=?', Q.event_code); }
    if (Q.channel) { if (!CHANNELS.includes(Q.channel)) f.add('channel', 'Must be IN_APP or EMAIL.'); else add('l.channel=?', Q.channel); }
    if (Q.status) { if (!['QUEUED', 'DELIVERED', 'FAILED'].includes(Q.status)) f.add('status', 'Must be QUEUED, DELIVERED or FAILED.'); else add('l.status=?', Q.status); }
    for (const [k, op] of [['from', '>='], ['to', '<=']]) if (Q[k] !== undefined && Q[k] !== '') { if (!S.isDate(Q[k])) f.add(k, 'Must be a date (YYYY-MM-DD).'); else add(`${DAY('l.created_at')} ${op} ?::date`, Q[k]); }
    f.check();
    res.json(await q(`select l.log_id, l.event_code, l.channel, l.status, l.subject, l.created_at, l.delivered_at, l.error, u.full_name recipient from notification_logs l left join users u on u.user_id=l.recipient_user_id
      where ${where.join(' and ')} order by l.created_at desc limit 200`, params));
  }));

  // ---------- S103 housekeeping ----------
  const taskSql = `select h.task_id, h.room_id, rm.room_number, h.task_type, h.status, h.assigned_to, u.full_name assigned_name, h.notes, h.priority, h.completion_note, du.full_name done_by_name, r.reservation_ref, h.created_at, h.started_at, h.done_at
    from housekeeping_tasks h join rooms rm using(room_id) join room_types t on t.room_type_id=rm.room_type_id join room_categories c on c.category_id=t.category_id
    left join users u on u.user_id=h.assigned_to left join users du on du.user_id=h.done_by left join reservations r on r.reservation_id=h.reservation_id where c.property_id=$1`;
  const taskOf = async (qq, req, id) => { const [x] = await qq(`${taskSql} and h.task_id=$2`, [prop(req), id]); if (!x) throw notFound('Task not found.'); return x; };
  app.get('/api/housekeeping/assignees', auth, need('stay.operate'), wrap(async (req, res) => res.json(await q(
    'select u.user_id, u.full_name, r.name role from users u join roles r using(role_id) where u.property_id=$1 and u.is_active order by u.full_name', [prop(req)]))));
  app.get('/api/housekeeping/tasks', auth, need('stay.operate'), wrap(async (req, res) => {
    const Q = req.query, f = new Fields(), params = [prop(req)], where = [];
    const add = (c, v) => { params.push(v); where.push(c.replace('?', '$' + params.length)); };
    if (Q.status) { if (!['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(Q.status)) f.add('status', 'Must be OPEN, IN_PROGRESS, DONE or CANCELLED.'); else add('h.status=?', Q.status); }
    if (Q.assigned_to) { const v = Q.assigned_to === 'me' ? req.user.user_id : Q.assigned_to; if (!isUuid(v)) f.add('assigned_to', 'A user id or "me".'); else add('h.assigned_to=?', v); }
    if (Q.room_id) { if (!isUuid(Q.room_id)) f.add('room_id', 'Must be a UUID.'); else add('h.room_id=?', Q.room_id); }
    if (Q.priority) { if (!PRIORITIES.includes(Q.priority)) f.add('priority', 'Must be NORMAL or HIGH.'); else add('h.priority=?', Q.priority); }
    f.check();
    res.json(await q(`${taskSql} ${where.length ? 'and ' + where.join(' and ') : ''} order by case h.status when 'IN_PROGRESS' then 0 when 'OPEN' then 1 else 2 end, case when h.status in ('OPEN','IN_PROGRESS') and h.priority='HIGH' then 0 else 1 end, coalesce(h.done_at, h.created_at) desc limit 200`, params));
  }));
  // cleaning history of one room: its finished cleans, newest first (default 20, at most 100)
  app.get('/api/housekeeping/rooms/:roomId/history', auth, need('stay.operate'), wrap(async (req, res) => {
    if (!isUuid(req.params.roomId)) throw bad('Please correct the fields listed.', [{ field: 'roomId', message: 'Must be a UUID.' }]);
    const f = new Fields(), raw = req.query.limit, limit = raw === undefined ? 20 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) f.add('limit', 'A whole number from 1 to 100.');
    f.check();
    await roomOf(q, req, req.params.roomId);
    res.json(await q(`${taskSql} and h.room_id=$2 and h.status='DONE' order by h.done_at desc limit ${limit}`, [prop(req), req.params.roomId]));
  }));
  app.post('/api/housekeeping/tasks', auth, need('stay.operate'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), type = b.task_type === undefined ? 'DAILY_CLEAN' : b.task_type;
    if (!isUuid(b.room_id)) f.add('room_id', 'Choose a room.');
    if (!TASK_TYPES.includes(type)) f.add('task_type', `Must be one of ${TASK_TYPES.join(', ')}.`);
    const notes = b.notes === undefined || b.notes === null || b.notes === '' ? null : String(b.notes).trim();
    if (notes !== null && notes.length > 300) f.add('notes', 'At most 300 characters.');
    if (b.assigned_to !== undefined && b.assigned_to !== null && !isUuid(b.assigned_to)) f.add('assigned_to', 'Must be a user id.');
    const priority = b.priority === undefined ? 'NORMAL' : b.priority;
    if (!PRIORITIES.includes(priority)) f.add('priority', 'Must be NORMAL or HIGH.');
    f.check();
    const id = await db().tx(async t => {
      await roomOf(t.q, req, b.room_id);
      if (b.assigned_to) await assignee(t.q, req, b.assigned_to);
      const [x] = await t.q('insert into housekeeping_tasks(room_id,task_type,notes,assigned_to,created_by,priority) values($1,$2,$3,$4,$5,$6) returning task_id', [b.room_id, type, notes, b.assigned_to || null, req.user.user_id, priority]);
      await S.audit(t.q, req.user.user_id, 'HOUSEKEEPING_TASK_CREATED', 'housekeeping_tasks', x.task_id, null, { room_id: b.room_id, task_type: type, priority });
      return x.task_id;
    });
    res.status(201).json(await taskOf(q, req, id));
  }));
  // change the notes or the priority of a task that is still open
  app.patch('/api/housekeeping/tasks/:id', auth, need('stay.operate'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), sets = {};
    if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) f.add('priority', 'Must be NORMAL or HIGH.'); else sets.priority = b.priority; }
    if (b.notes !== undefined) {
      const n = b.notes === null || b.notes === '' ? null : String(b.notes).trim();
      if (n !== null && n.length > 300) f.add('notes', 'At most 300 characters.'); else sets.notes = n;
    }
    if (!Object.keys(sets).length && !f.any) f.add('body', 'Send notes or priority.');
    f.check();
    await db().tx(async t => {
      const x = await taskOf(t.q, req, req.params.id);
      if (!['OPEN', 'IN_PROGRESS'].includes(x.status)) throw conflict(`Only an open task can be changed. This one is ${x.status}.`, 'INVALID_STATE');
      const keys = Object.keys(sets);
      await t.q(`update housekeeping_tasks set ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} where task_id=$1`, [x.task_id, ...keys.map(k => sets[k])]);
      await S.audit(t.q, req.user.user_id, 'HOUSEKEEPING_UPDATED', 'housekeeping_tasks', x.task_id, { notes: x.notes, priority: x.priority }, { ...{ notes: x.notes, priority: x.priority }, ...sets });
    });
    res.json(await taskOf(q, req, req.params.id));
  }));
  async function assignee(qq, req, userId) {
    const [u] = await qq('select user_id from users where user_id=$1 and property_id=$2 and is_active', [userId, prop(req)]);
    if (!u) throw bad('That person cannot be assigned.', [{ field: 'user_id', message: 'Choose an active user of this property.' }]);
  }
  app.post('/api/housekeeping/tasks/:id/assign', auth, need('stay.operate'), wrap(async (req, res) => {
    const uid = (req.body || {}).user_id;
    if (!isUuid(uid)) throw bad('Choose who does the task.', [{ field: 'user_id', message: 'Must be a user id.' }]);
    await db().tx(async t => {
      const x = await taskOf(t.q, req, req.params.id); await assignee(t.q, req, uid);
      const [u] = await t.q("update housekeeping_tasks set assigned_to=$2 where task_id=$1 and status in ('OPEN','IN_PROGRESS') returning task_id", [x.task_id, uid]);
      if (!u) throw conflict(`A ${x.status.toLowerCase().replace('_', ' ')} task cannot be assigned.`, 'INVALID_STATE');
      await S.audit(t.q, req.user.user_id, 'HOUSEKEEPING_ASSIGNED', 'housekeeping_tasks', x.task_id, { assigned_to: x.assigned_to }, { assigned_to: uid });
    });
    res.json(await taskOf(q, req, req.params.id));
  }));
  app.post('/api/housekeeping/tasks/:id/start', auth, need('stay.operate'), wrap(async (req, res) => {
    await db().tx(async t => {
      const x = await taskOf(t.q, req, req.params.id);
      const [u] = await t.q("update housekeeping_tasks set status='IN_PROGRESS', started_at=now(), assigned_to=coalesce(assigned_to,$2) where task_id=$1 and status='OPEN' returning task_id", [x.task_id, req.user.user_id]);
      if (!u) throw conflict(`Only an open task can be started. This one is ${x.status}.`, 'INVALID_STATE');
      await S.audit(t.q, req.user.user_id, 'HOUSEKEEPING_STARTED', 'housekeeping_tasks', x.task_id, { status: 'OPEN' }, { status: 'IN_PROGRESS' });
    });
    res.json(await taskOf(q, req, req.params.id));
  }));
  // finishing a clean makes the room sellable again (CLEANING -> AVAILABLE). A room taken out of service meanwhile is not touched.
  app.post('/api/housekeeping/tasks/:id/complete', auth, need('stay.operate'), wrap(async (req, res) => {
    const f = new Fields(), note = (req.body || {}).note === undefined || req.body.note === null || req.body.note === '' ? null : String(req.body.note).trim();
    if (note !== null && note.length > 300) f.add('note', 'At most 300 characters.');
    f.check();
    await db().tx(async t => {
      const x = await taskOf(t.q, req, req.params.id), room = await roomOf(t.q, req, x.room_id);
      if (!['OPEN', 'IN_PROGRESS'].includes(x.status)) throw conflict(`Only an open task can be completed. This one is ${x.status}.`, 'INVALID_STATE');
      const moves = x.task_type !== 'DAILY_CLEAN' && room.status === 'CLEANING';
      if (x.task_type !== 'DAILY_CLEAN' && ['OCCUPIED', 'MAINTENANCE_BLOCKED'].includes(room.status)) throw conflict(`Room ${room.room_number} is ${room.status} now, so the clean cannot finish it. Cancel the task or free the room first.`, 'INVALID_STATE');
      const [u] = await t.q("update housekeeping_tasks set status='DONE', done_at=now(), done_by=$2, completion_note=$3, assigned_to=coalesce(assigned_to,$2) where task_id=$1 and status in ('OPEN','IN_PROGRESS') returning task_id", [x.task_id, req.user.user_id, note]);
      if (!u) throw conflict('The task changed while you were working. Reload and try again.', 'INVALID_STATE');
      if (moves) { await S.moveRoom(t.q, room.room_id, 'AVAILABLE', req.user.user_id, 'cleaning done'); await S.notify(t.q, prop(req), 'ROOM_READY', `Room ${room.room_number} is ready`, { room_id: room.room_id }); }
      await S.audit(t.q, req.user.user_id, 'HOUSEKEEPING_DONE', 'housekeeping_tasks', x.task_id, { status: x.status }, { status: 'DONE', room: room.room_number, room_status: moves ? 'AVAILABLE' : room.status });
    });
    res.json(await taskOf(q, req, req.params.id));
  }));
  app.post('/api/housekeeping/tasks/:id/cancel', auth, need('stay.operate'), wrap(async (req, res) => {
    await db().tx(async t => {
      const x = await taskOf(t.q, req, req.params.id);
      const [u] = await t.q("update housekeeping_tasks set status='CANCELLED' where task_id=$1 and status in ('OPEN','IN_PROGRESS') returning task_id", [x.task_id]);
      if (!u) throw conflict(`Only an open task can be cancelled. This one is ${x.status}.`, 'INVALID_STATE');
      await S.audit(t.q, req.user.user_id, 'HOUSEKEEPING_CANCELLED', 'housekeeping_tasks', x.task_id, { status: x.status }, { status: 'CANCELLED' });
    });
    res.json(await taskOf(q, req, req.params.id));
  }));

  // ---------- S104 maintenance reports, room blocking and release ----------
  const maintSql = `select m.report_id, m.room_id, rm.room_number, m.issue, m.severity, m.blocks_room, m.status, m.reported_at, ru.full_name reported_by, m.resolved_at, m.resolution_note, xu.full_name resolved_by
    from maintenance_reports m join rooms rm using(room_id) join room_types t on t.room_type_id=rm.room_type_id join room_categories c on c.category_id=t.category_id
    left join users ru on ru.user_id=m.reported_by left join users xu on xu.user_id=m.resolved_by where c.property_id=$1`;
  const reportOf = async (qq, req, id) => { const [x] = await qq(`${maintSql} and m.report_id=$2`, [prop(req), id]); if (!x) throw notFound('Report not found.'); return x; };
  app.get('/api/maintenance', auth, need('stay.operate'), wrap(async (req, res) => {
    const Q = req.query, f = new Fields(), params = [prop(req)], where = [];
    const add = (c, v) => { params.push(v); where.push(c.replace('?', '$' + params.length)); };
    if (Q.status) { if (!['OPEN', 'RESOLVED', 'CANCELLED'].includes(Q.status)) f.add('status', 'Must be OPEN, RESOLVED or CANCELLED.'); else add('m.status=?', Q.status); }
    if (Q.room_id) { if (!isUuid(Q.room_id)) f.add('room_id', 'Must be a UUID.'); else add('m.room_id=?', Q.room_id); }
    f.check();
    res.json(await q(`${maintSql} ${where.length ? 'and ' + where.join(' and ') : ''} order by m.reported_at desc limit 200`, params));
  }));
  app.post('/api/maintenance', auth, need('stay.operate'), wrap(async (req, res) => {
    const b = req.body || {}, f = new Fields(), issue = typeof b.issue === 'string' ? b.issue.trim() : '', severity = b.severity === undefined ? 'MEDIUM' : b.severity;
    if (!isUuid(b.room_id)) f.add('room_id', 'Choose a room.');
    if (issue.length < 3 || issue.length > 300) f.add('issue', 'Describe the problem in 3 to 300 characters.');
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(severity)) f.add('severity', 'Must be LOW, MEDIUM or HIGH.');
    if (b.block_room !== undefined && typeof b.block_room !== 'boolean') f.add('block_room', 'Must be true or false.');
    f.check();
    let affected = [];
    const id = await db().tx(async t => {
      const room = await roomOf(t.q, req, b.room_id);
      if (b.block_room) {
        if (room.status === 'OCCUPIED') throw conflict(`Room ${room.room_number} has a guest in it. Move the guest first, then block the room.`, 'INVALID_STATE');
        await S.moveRoom(t.q, room.room_id, 'MAINTENANCE_BLOCKED', req.user.user_id, 'maintenance');
        affected = await t.q(`select r.reservation_ref, r.check_in_date::text check_in, r.check_out_date::text check_out from reservation_rooms rr join reservations r using(reservation_id)
          where rr.room_id=$1 and r.status='CONFIRMED' and r.check_out_date>$2::date order by r.check_in_date`, [room.room_id, S.today()]);
      }
      const [x] = await t.q('insert into maintenance_reports(room_id,issue,severity,blocks_room,reported_by) values($1,$2,$3,$4,$5) returning report_id', [room.room_id, issue, severity, !!b.block_room, req.user.user_id]);
      await S.audit(t.q, req.user.user_id, 'MAINTENANCE_REPORTED', 'maintenance_reports', x.report_id, null, { room: room.room_number, issue, severity, blocked: !!b.block_room });
      await S.notify(t.q, prop(req), 'MAINTENANCE_REPORTED', `Room ${room.room_number}: ${issue}`, { report_id: x.report_id, severity, blocked: !!b.block_room });
      return x.report_id;
    });
    res.status(201).json({ ...(await reportOf(q, req, id)), affected_reservations: affected });
  }));
  // Release: when the last blocking report of a room is closed, the room goes to CLEANING (it is checked and cleaned before it is sold again; assumption), with an inspection task.
  async function closeReport(req, res, to) {
    const note = (req.body || {}).note, f = new Fields();
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 300)) f.add('note', 'At most 300 characters.');
    f.check();
    await db().tx(async t => {
      const x = await reportOf(t.q, req, req.params.id);
      await t.q('select room_id from rooms where room_id=$1 for update', [x.room_id]);
      const [u] = await t.q("update maintenance_reports set status=$2, resolved_by=$3, resolved_at=now(), resolution_note=$4 where report_id=$1 and status='OPEN' returning report_id", [x.report_id, to, req.user.user_id, note || null]);
      if (!u) throw conflict(`This report is already ${x.status}.`, 'INVALID_STATE');
      let released = false;
      if (x.blocks_room) {
        const [more] = await t.q("select count(*)::int n from maintenance_reports where room_id=$1 and status='OPEN' and blocks_room", [x.room_id]);
        const room = await roomOf(t.q, req, x.room_id);
        if (more.n === 0 && room.status === 'MAINTENANCE_BLOCKED') {
          await S.moveRoom(t.q, x.room_id, 'CLEANING', req.user.user_id, 'maintenance released');
          await t.q("insert into housekeeping_tasks(room_id,task_type,notes,created_by) values($1,'INSPECTION','After maintenance',$2)", [x.room_id, req.user.user_id]);
          released = true;
        }
      }
      await S.audit(t.q, req.user.user_id, to === 'RESOLVED' ? 'MAINTENANCE_RESOLVED' : 'MAINTENANCE_CANCELLED', 'maintenance_reports', x.report_id, { status: 'OPEN' }, { status: to, room: x.room_number, released });
    });
    res.json(await reportOf(q, req, req.params.id));
  }
  app.post('/api/maintenance/:id/resolve', auth, need('maintenance.release'), wrap((req, res) => closeReport(req, res, 'RESOLVED')));
  app.post('/api/maintenance/:id/cancel', auth, need('maintenance.release'), wrap((req, res) => closeReport(req, res, 'CANCELLED')));

  // ---------- S106 reports and dashboard summary ----------
  app.get('/api/reports/occupancy', auth, need('reports.operational'), wrap(async (req, res) => {
    const f = new Fields(); range(req.query, f);
    const { from, to } = req.query;
    const [tr] = await q(`select count(*)::int n from rooms r join room_types t using(room_type_id) join room_categories c using(category_id) where c.property_id=$1`, [prop(req)]);
    const days = await q(`select d::date::text date,
        (select count(*) from reservation_rooms rr join reservations r using(reservation_id) join room_types t on t.room_type_id=rr.room_type_id join room_categories c on c.category_id=t.category_id
          where c.property_id=$3 and r.status in ('CONFIRMED','CHECKED_IN','CHECKED_OUT') and r.check_in_date<=d::date and r.check_out_date>d::date)::int occupied,
        (select coalesce(sum(ch.amount),0)::float8 from charges ch join folios fo using(folio_id) join reservations r using(reservation_id)
          where r.property_id=$3 and r.status in ('CONFIRMED','CHECKED_IN','CHECKED_OUT') and ch.charge_type='ROOM' and ch.voided_at is null and ch.stay_date=d::date) room_revenue
      from generate_series($1::date, $2::date, interval '1 day') d order by d`, [from, to, prop(req)]);
    const rows = days.map(d => ({ date: d.date, rooms_total: tr.n, rooms_occupied: d.occupied, occupancy_pct: tr.n ? Math.round(d.occupied / tr.n * 1000) / 10 : 0, room_revenue: money(d.room_revenue) }));
    const occ = rows.reduce((a, d) => a + d.rooms_occupied, 0), avail = tr.n * rows.length, rev = money(rows.reduce((a, d) => a + d.room_revenue, 0));
    res.json({ from, to, rooms_total: tr.n, days: rows,
      totals: { occupied_nights: occ, available_nights: avail, occupancy_pct: avail ? Math.round(occ / avail * 1000) / 10 : 0, room_revenue: rev, adr: occ ? money(rev / occ) : 0, revpar: avail ? money(rev / avail) : 0 } });
  }));
  app.get('/api/reports/payments', auth, need('reports.full'), wrap(async (req, res) => {
    const f = new Fields(); range(req.query, f);
    const { from, to } = req.query;
    const pay = await q(`select ${DAY('p.paid_at')}::text date, p.method, p.kind, count(*)::int n, sum(p.amount)::float8 total from payments p join folios fo using(folio_id) join reservations r using(reservation_id)
      where r.property_id=$1 and p.status='COMPLETED' and ${DAY('p.paid_at')} between $2::date and $3::date group by 1, 2, 3`, [prop(req), from, to]);
    const ref = await q(`select ${DAY('rf.decided_at')}::text date, p.method, count(*)::int n, sum(rf.amount)::float8 total from refunds rf join payments p using(payment_id) join folios fo on fo.folio_id=rf.folio_id join reservations r using(reservation_id)
      where r.property_id=$1 and rf.status='COMPLETED' and ${DAY('rf.decided_at')} between $2::date and $3::date group by 1, 2`, [prop(req), from, to]);
    const days = {}, methods = {};
    const day = d => days[d] || (days[d] = { date: d, payments: 0, deposits: 0, refunds: 0, net: 0 });
    const meth = m => methods[m] || (methods[m] = { method: m, payments: 0, deposits: 0, refunds: 0, net: 0 });
    for (const x of pay) for (const e of [day(x.date), meth(x.method)]) e[x.kind === 'DEPOSIT' ? 'deposits' : 'payments'] += x.total;
    for (const x of ref) for (const e of [day(x.date), meth(x.method)]) e.refunds += x.total;
    const fin = e => ({ ...e, payments: money(e.payments), deposits: money(e.deposits), refunds: money(e.refunds), net: money(e.payments + e.deposits - e.refunds) });
    const dl = Object.values(days).map(fin).sort((a, b) => a.date < b.date ? -1 : 1), ml = Object.values(methods).map(fin).sort((a, b) => a.method < b.method ? -1 : 1);
    res.json({ from, to, days: dl, by_method: ml, totals: fin(dl.reduce((a, e) => ({ payments: a.payments + e.payments, deposits: a.deposits + e.deposits, refunds: a.refunds + e.refunds }), { payments: 0, deposits: 0, refunds: 0 })) });
  }));
  // the money figures are for reports.full; Front Desk (operational reports) gets everything else
  app.get('/api/reports/summary', auth, need('reports.operational'), wrap(async (req, res) => {
    const p = prop(req), t = S.today(), money_ok = P.can(req.user, 'reports.full');
    const [c] = await q(`select
      (select count(*) from reservations where property_id=$1 and status='CONFIRMED' and check_in_date=$2::date)::int arrivals_today,
      (select count(*) from reservations where property_id=$1 and status='CHECKED_IN' and check_out_date<=$2::date)::int departures_due,
      (select count(*) from reservations where property_id=$1 and status='CHECKED_IN')::int in_house,
      (select count(*) from housekeeping_tasks h join rooms rm using(room_id) join room_types t2 on t2.room_type_id=rm.room_type_id join room_categories c on c.category_id=t2.category_id where c.property_id=$1 and h.status='OPEN')::int hk_open,
      (select count(*) from housekeeping_tasks h join rooms rm using(room_id) join room_types t2 on t2.room_type_id=rm.room_type_id join room_categories c on c.category_id=t2.category_id where c.property_id=$1 and h.status='IN_PROGRESS')::int hk_in_progress,
      (select count(*) from maintenance_reports m join rooms rm using(room_id) join room_types t2 on t2.room_type_id=rm.room_type_id join room_categories c on c.category_id=t2.category_id where c.property_id=$1 and m.status='OPEN')::int maintenance_open,
      (select count(*) from refunds rf join folios fo using(folio_id) join reservations r using(reservation_id) where r.property_id=$1 and rf.status='REQUESTED')::int refunds_pending`, [p, t]);
    const rooms = await q(`select st.code status, count(*)::int n from rooms r join room_types t2 using(room_type_id) join room_categories c using(category_id) join room_statuses st on st.status_id=r.status_id where c.property_id=$1 group by 1`, [p]);
    const byStatus = { AVAILABLE: 0, OCCUPIED: 0, CLEANING: 0, MAINTENANCE_BLOCKED: 0 }; rooms.forEach(x => byStatus[x.status] = x.n);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const [occ] = await q(`select count(*)::int n from reservation_rooms rr join reservations r using(reservation_id) where r.property_id=$1 and r.status in ('CONFIRMED','CHECKED_IN','CHECKED_OUT') and r.check_in_date<=$2::date and r.check_out_date>$2::date`, [p, t]);
    const bySource = await q(`select s.name source, count(*)::int n from reservations r join booking_sources s using(source_id) where r.property_id=$1 and ${DAY('r.created_at')} >= $2::date group by 1 order by 2 desc, 1`, [p, S.addDays(t, -29)]);
    let outstanding = null, today = null;
    if (money_ok) {
      outstanding = 0;
      for (const f of await q("select fo.folio_id from folios fo join reservations r using(reservation_id) where r.property_id=$1 and r.status='CHECKED_IN'", [p])) outstanding += Math.max((await S.folioTotals(q, f.folio_id)).balance, 0);
      const [pt] = await q(`select coalesce(sum(p.amount),0)::float8 total, count(*)::int n from payments p join folios fo using(folio_id) join reservations r using(reservation_id) where r.property_id=$1 and p.status='COMPLETED' and ${DAY('p.paid_at')}=$2::date`, [p, t]);
      const [rt] = await q(`select coalesce(sum(rf.amount),0)::float8 total from refunds rf join folios fo using(folio_id) join reservations r using(reservation_id) where r.property_id=$1 and rf.status='COMPLETED' and ${DAY('rf.decided_at')}=$2::date`, [p, t]);
      today = { received: money(pt.total), refunded: money(rt.total), net: money(pt.total - rt.total), payments: pt.n };
    }
    res.json({ today: t, arrivals_today: c.arrivals_today, departures_due: c.departures_due, in_house: c.in_house,
      rooms: { total, ...Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k.toLowerCase(), v])) },
      occupancy_pct_today: total ? Math.round(occ.n / total * 1000) / 10 : 0,
      housekeeping: { open: c.hk_open, in_progress: c.hk_in_progress }, maintenance_open: c.maintenance_open, refunds_pending: c.refunds_pending,
      bookings_by_source_30d: bySource, outstanding_balance_in_house: outstanding === null ? null : money(outstanding), payments_today: today });
  }));
};
