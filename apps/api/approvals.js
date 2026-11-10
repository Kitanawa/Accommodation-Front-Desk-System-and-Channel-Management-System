// M17 (S133 to S138): the manager approval inbox. One API over the three things that wait for approval:
// a new room type (with its rates), a rate rule (new or a change), and an add-on (new, or a new price).
// The desktop endpoints (/api/room-types/:id/approve, /api/rates/:id/approve, /api/add-ons/:id/approve) call the same functions,
// so there is one set of rules, and every decision is written to approval_decisions and the audit trail (S137).
const crypto = require('crypto');
const S = require('./service');
const { bad, notFound, conflict, Fields, isUuid } = require('./errors');

const KINDS = ['ROOM_TYPE', 'RATE', 'ADD_ON'];
const md5 = o => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').slice(0, 16);

// ---- reading what is waiting ----
const rateCols = 'rr.rate_rule_id, rr.room_type_id, rr.rule_type, rr.rate_amount::float8 rate_amount, rr.date_from::text date_from, rr.date_to::text date_to, rr.selected_days, rr.specific_date::text specific_date, rr.priority, rr.supersedes_id, rr.effective_from::text effective_from, rr.approval_status, rr.created_at';
async function loadPending(q, propertyId, kind, id, lock) {
  const fu = lock ? ' for update of ' : '';
  if (kind === 'ROOM_TYPE') {
    const [t] = await q(`select t.room_type_id, t.name, c.name category, t.max_guests, t.min_nights, t.description, t.approval_status from room_types t join room_categories c using(category_id)
      where t.room_type_id=$1 and c.property_id=$2${fu}${lock ? 't' : ''}`, [id, propertyId]);
    if (!t || t.approval_status !== 'PENDING') return null;
    const rates = await q(`select ${rateCols} from rate_rules rr where rr.room_type_id=$1 and rr.approval_status='PENDING' and rr.supersedes_id is null order by rr.rule_type, rr.created_at`, [id]);
    const base = rates.find(r => r.rule_type === 'BASE');
    const first = rates.reduce((a, r) => (!a || r.created_at < a ? r.created_at : a), null);
    return { kind, id, title: `New room type: ${t.name}`, summary: `${t.category}, up to ${t.max_guests} guests${base ? ', base rate ' + base.rate_amount.toFixed(2) : ', no base rate yet'}`,
      submitted_at: first, details: { name: t.name, category: t.category, max_guests: t.max_guests, min_nights: t.min_nights, description: t.description, rates: rates.map(({ created_at, ...r }) => r) },
      revision: md5([t.name, t.max_guests, t.min_nights, rates.map(r => [r.rate_rule_id, r.rate_amount, r.rule_type, r.date_from, r.date_to, r.selected_days, r.specific_date, r.priority])]) };
  }
  if (kind === 'RATE') {
    const [r] = await q(`select ${rateCols}, t.name room_type, t.approval_status type_status from rate_rules rr join room_types t using(room_type_id) join room_categories c on c.category_id=t.category_id
      where rr.rate_rule_id=$1 and c.property_id=$2${fu}${lock ? 'rr' : ''}`, [id, propertyId]);
    if (!r || r.approval_status !== 'PENDING' || r.type_status !== 'APPROVED') return null;      // rates of a pending room type are decided with the room type
    let current = null;
    if (r.supersedes_id) [current] = await q('select rate_rule_id, rate_amount::float8 rate_amount from rate_rules where rate_rule_id=$1', [r.supersedes_id]);
    const { type_status, room_type, created_at, ...rate } = r;
    return { kind, id, title: `${r.supersedes_id ? 'Rate change' : 'New rate'}: ${room_type}`, submitted_at: created_at,
      summary: `${r.rule_type.toLowerCase().replace('_', ' ')} ${r.rate_amount.toFixed(2)}${current ? ' (now ' + current.rate_amount.toFixed(2) + ')' : ''}`,
      details: { room_type, ...rate, current_rate: current ? current.rate_amount : null },
      revision: md5([r.rate_amount, r.rule_type, r.date_from, r.date_to, r.selected_days, r.specific_date, r.priority, r.supersedes_id, r.effective_from]) };
  }
  const [a] = await q(`select a.add_on_id, a.name, a.description, a.pricing_unit, a.unit_price::float8 unit_price, a.pending_unit_price::float8 pending_unit_price, a.approval_status, a.created_at
    from add_ons a where a.add_on_id=$1 and a.property_id=$2${fu}${lock ? 'a' : ''}`, [id, propertyId]);
  if (!a || (a.approval_status !== 'PENDING' && a.pending_unit_price === null)) return null;
  const isNew = a.approval_status === 'PENDING';
  return { kind, id, title: isNew ? `New add-on: ${a.name}` : `Price change: ${a.name}`, submitted_at: a.created_at,
    summary: isNew ? `${a.pricing_unit.toLowerCase().replace('_', ' ')} ${a.unit_price.toFixed(2)}` : `${a.unit_price.toFixed(2)} to ${a.pending_unit_price.toFixed(2)}`,
    details: { name: a.name, description: a.description, pricing_unit: a.pricing_unit, unit_price: a.unit_price, pending_unit_price: a.pending_unit_price, is_new: isNew },
    revision: md5([a.name, a.pricing_unit, a.unit_price, a.pending_unit_price, a.approval_status]) };
}
const decisionOf = async (q, propertyId, kind, id) => (await q(`select d.decision, d.reason, d.decided_at, u.full_name decided_by, d.snapshot from approval_decisions d join users u on u.user_id=d.decided_by
  where d.property_id=$1 and d.kind=$2 and d.subject_id=$3 order by d.decision_id desc limit 1`, [propertyId, kind, id]))[0];

// ---- deciding ----
// The caller has the transaction. The subject row is locked, then checked: still waiting? still the version the manager saw?
async function guard(t, propertyId, kind, id, revision) {
  const item = await loadPending(t.q, propertyId, kind, id, true);
  if (!item) {
    const d = await decisionOf(t.q, propertyId, kind, id);
    if (d) throw conflict(`This request was already ${d.decision.toLowerCase()} by ${d.decided_by}.`, 'INVALID_STATE');
    const [exists] = await t.q(kind === 'ROOM_TYPE' ? 'select 1 x from room_types t join room_categories c using(category_id) where t.room_type_id=$1 and c.property_id=$2'
      : kind === 'RATE' ? 'select 1 x from rate_rules rr join room_types t using(room_type_id) join room_categories c on c.category_id=t.category_id where rr.rate_rule_id=$1 and c.property_id=$2'
      : 'select 1 x from add_ons where add_on_id=$1 and property_id=$2', [id, propertyId]);
    if (exists) throw conflict('Nothing is waiting for approval here.', 'INVALID_STATE');
    throw notFound('Request not found.');
  }
  if (revision !== undefined && revision !== null && revision !== item.revision) throw conflict('This request changed after you opened it. Open it again and check the new values.', 'STALE_REQUEST');
  return item;
}
async function record(t, propertyId, userId, item, decision, reason, extra) {
  await t.q('insert into approval_decisions(property_id,kind,subject_id,decision,reason,decided_by,snapshot) values($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [propertyId, item.kind, item.id, decision, reason || null, userId, JSON.stringify({ title: item.title, summary: item.summary, details: item.details, ...(extra || {}) })]);
}

async function approve(t, propertyId, userId, kind, id, revision) {
  const item = await guard(t, propertyId, kind, id, revision);
  let extra = {};
  if (kind === 'ROOM_TYPE') {
    const [base] = await t.q("select 1 x from rate_rules where room_type_id=$1 and rule_type='BASE' and approval_status='PENDING' and supersedes_id is null", [id]);
    if (!base) throw conflict('Add a Base Rate before approving this room type.', 'INVALID_STATE');
    const rates = await t.q("update rate_rules set approval_status='APPROVED' where room_type_id=$1 and approval_status='PENDING' and supersedes_id is null returning rate_rule_id", [id]);
    await t.q("update room_types set approval_status='APPROVED' where room_type_id=$1", [id]);
    await S.audit(t.q, userId, 'ROOM_TYPE_APPROVED', 'room_types', id, { approval_status: 'PENDING' }, { approval_status: 'APPROVED', rates_approved: rates.length });
    extra = { rates_approved: rates.length };
  } else if (kind === 'RATE') {
    const r = item.details;
    let effective = null;
    if (r.supersedes_id) {
      const [old] = await t.q('select rate_rule_id, approval_status, valid_until from rate_rules where rate_rule_id=$1 for update', [r.supersedes_id]);
      if (!old || old.approval_status !== 'APPROVED' || old.valid_until) throw conflict('The rate this change replaces is no longer in force. Reject this change.', 'INVALID_STATE');
      effective = r.effective_from || S.today();
      await t.q(`with recursive chain as (select rate_rule_id, supersedes_id from rate_rules where rate_rule_id=$1
          union all select r.rate_rule_id, r.supersedes_id from rate_rules r join chain c on r.rate_rule_id=c.supersedes_id)
        update rate_rules set valid_until=$2::date where rate_rule_id in (select rate_rule_id from chain) and (valid_until is null or valid_until>$2::date)`, [old.rate_rule_id, effective]);
    } else if (r.rule_type === 'BASE') {
      const [ex] = await t.q("select 1 x from rate_rules where room_type_id=$1 and rule_type='BASE' and approval_status='APPROVED' and valid_until is null", [r.room_type_id]);
      if (ex) throw conflict('This room type already has an approved Base Rate. Use "change rate" on it instead.', 'BASE_RATE_EXISTS');
    }
    await t.q("update rate_rules set approval_status='APPROVED', effective_from=coalesce($2::date, effective_from) where rate_rule_id=$1", [id, effective]);
    await S.audit(t.q, userId, 'RATE_APPROVED', 'rate_rules', id, { approval_status: 'PENDING' }, { approval_status: 'APPROVED', effective_from: effective });
    extra = { effective_from: effective };
  } else if (item.details.is_new) {
    await t.q("update add_ons set approval_status='APPROVED' where add_on_id=$1", [id]);
    await S.audit(t.q, userId, 'ADD_ON_APPROVED', 'add_ons', id, { approval_status: 'PENDING' }, { approval_status: 'APPROVED' });
  } else {
    await t.q('update add_ons set unit_price=pending_unit_price, pending_unit_price=null where add_on_id=$1', [id]);
    await S.audit(t.q, userId, 'ADD_ON_PRICE_APPROVED', 'add_ons', id, { unit_price: item.details.unit_price }, { unit_price: item.details.pending_unit_price });
  }
  await record(t, propertyId, userId, item, 'APPROVED', null, extra);
  await S.audit(t.q, userId, 'APPROVAL_DECIDED', kind === 'ROOM_TYPE' ? 'room_types' : kind === 'RATE' ? 'rate_rules' : 'add_ons', id, { status: 'PENDING' }, { status: 'APPROVED', kind });
  return { item, ...extra };
}

// Reject: the request is taken away (a pending room type, rate or add-on has not been in use) and a copy stays in the decision history with the reason.
async function reject(t, propertyId, userId, kind, id, reason, revision) {
  const item = await guard(t, propertyId, kind, id, revision);
  if (kind === 'ROOM_TYPE') {
    const [used] = await t.q('select 1 x from reservation_rooms where room_type_id=$1 limit 1', [id]);
    if (used) throw conflict('This room type has reservations.', 'INVALID_STATE');
    await t.q('delete from rate_rules where room_type_id=$1', [id]);
    await t.q('delete from room_stock where room_type_id=$1', [id]);
    await t.q('delete from rooms where room_type_id=$1', [id]);
    await t.q('delete from room_types where room_type_id=$1', [id]);
  } else if (kind === 'RATE') {
    await t.q('delete from rate_rules where rate_rule_id=$1', [id]);
  } else if (item.details.is_new) {
    const [used] = await t.q('select 1 x from charges where add_on_id=$1 limit 1', [id]);
    if (used) throw conflict('This add-on is already used on a folio.', 'INVALID_STATE');
    await t.q('delete from add_ons where add_on_id=$1', [id]);
  } else {
    await t.q('update add_ons set pending_unit_price=null where add_on_id=$1', [id]);
  }
  await record(t, propertyId, userId, item, 'REJECTED', reason);
  await S.audit(t.q, userId, 'APPROVAL_REJECTED', kind === 'ROOM_TYPE' ? 'room_types' : kind === 'RATE' ? 'rate_rules' : 'add_ons', id, { status: 'PENDING', title: item.title }, { status: 'REJECTED', kind, reason });
  return item;
}

// ---- endpoints ----
function mount(app, { getDb, auth, need, wrap }) {
  const db = () => getDb(), q = (s, p) => db().q(s, p), prop = req => req.user.property_id;
  const gate = [auth, need('rates.approve')];                      // S133: Administrator, or a Manager who was given the right; nobody else, on every route below
  const kindOf = (req, f) => { const k = String(req.params.kind || '').toUpperCase(); if (!KINDS.includes(k)) throw bad('Unknown request type.', [{ field: 'kind', message: `Must be one of ${KINDS.join(', ')}.` }]); return k; };

  async function pendingList(propertyId, kindFilter) {
    const out = [];
    const typeIds = kindFilter && kindFilter !== 'ROOM_TYPE' ? [] : await q("select t.room_type_id id from room_types t join room_categories c using(category_id) where c.property_id=$1 and t.approval_status='PENDING'", [propertyId]);
    for (const r of typeIds) { const x = await loadPending(q, propertyId, 'ROOM_TYPE', r.id); if (x) out.push(x); }
    const rateIds = kindFilter && kindFilter !== 'RATE' ? [] : await q("select rr.rate_rule_id id from rate_rules rr join room_types t using(room_type_id) join room_categories c on c.category_id=t.category_id where c.property_id=$1 and rr.approval_status='PENDING' and t.approval_status='APPROVED'", [propertyId]);
    for (const r of rateIds) { const x = await loadPending(q, propertyId, 'RATE', r.id); if (x) out.push(x); }
    const addIds = kindFilter && kindFilter !== 'ADD_ON' ? [] : await q("select add_on_id id from add_ons where property_id=$1 and (approval_status='PENDING' or pending_unit_price is not null)", [propertyId]);
    for (const r of addIds) { const x = await loadPending(q, propertyId, 'ADD_ON', r.id); if (x) out.push(x); }
    return out.sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1)).map(x => ({ ...x, status: 'PENDING', decision: null }));
  }
  const decided = (d, kind, id) => ({ kind, id, status: d.decision, title: d.snapshot.title, summary: d.snapshot.summary, submitted_at: null, details: d.snapshot.details, revision: null,
    decision: { decision: d.decision, reason: d.reason, decided_by: d.decided_by, decided_at: d.decided_at } });

  app.get('/api/approvals/summary', ...gate, wrap(async (req, res) => {
    const list = await pendingList(prop(req));
    res.json({ pending: list.length, by_kind: Object.fromEntries(KINDS.map(k => [k, list.filter(x => x.kind === k).length])), oldest_submitted_at: list.length ? list[0].submitted_at : null });
  }));
  app.get('/api/approvals', ...gate, wrap(async (req, res) => {
    const Q = req.query, f = new Fields(), status = Q.status === undefined ? 'PENDING' : String(Q.status).toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) f.add('status', 'Must be PENDING, APPROVED or REJECTED.');
    const kind = Q.kind === undefined ? null : String(Q.kind).toUpperCase();
    if (kind && !KINDS.includes(kind)) f.add('kind', `Must be one of ${KINDS.join(', ')}.`);
    let limit = 50; if (Q.limit !== undefined) { limit = Number(Q.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 100) f.add('limit', 'Whole number from 1 to 100.'); }
    f.check();
    if (status === 'PENDING') return res.json((await pendingList(prop(req), kind)).slice(0, limit));
    const rows = await q(`select d.kind, d.subject_id id, d.decision, d.reason, d.decided_at, u.full_name decided_by, d.snapshot from approval_decisions d join users u on u.user_id=d.decided_by
      where d.property_id=$1 and d.decision=$2 and ($3::text is null or d.kind=$3) order by d.decision_id desc limit $4`, [prop(req), status, kind, limit]);
    res.json(rows.map(d => decided(d, d.kind, d.id)));
  }));
  app.get('/api/approvals/:kind/:id', ...gate, wrap(async (req, res) => {
    const kind = kindOf(req), item = await loadPending(q, prop(req), kind, req.params.id);
    if (item) return res.json({ ...item, status: 'PENDING', decision: null });
    const d = await decisionOf(q, prop(req), kind, req.params.id);
    if (!d) throw notFound('Request not found.');
    res.json(decided(d, kind, req.params.id));
  }));
  const body = (req, needReason) => {
    const b = req.body || {}, f = new Fields();
    if (b.revision !== undefined && b.revision !== null && (typeof b.revision !== 'string' || b.revision.length > 40)) f.add('revision', 'Send the revision text exactly as the request showed it.');
    let reason = null;
    if (needReason || (b.reason !== undefined && b.reason !== null && b.reason !== '')) {
      reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (needReason ? (reason.length < 3 || reason.length > 300) : reason.length > 300) f.add('reason', needReason ? 'A reason of 3 to 300 characters is required.' : 'At most 300 characters.');
    }
    f.check();
    return { revision: b.revision ?? undefined, reason };
  };
  app.post('/api/approvals/:kind/:id/approve', ...gate, wrap(async (req, res) => {
    const kind = kindOf(req), b = body(req, false);
    await db().tx(t => approve(t, prop(req), req.user.user_id, kind, req.params.id, b.revision));
    res.json({ ok: true, ...decided((await decisionOf(q, prop(req), kind, req.params.id)), kind, req.params.id) });
  }));
  app.post('/api/approvals/:kind/:id/reject', ...gate, wrap(async (req, res) => {
    const kind = kindOf(req), b = body(req, true);
    await db().tx(t => reject(t, prop(req), req.user.user_id, kind, req.params.id, b.reason, b.revision));
    res.json({ ok: true, ...decided((await decisionOf(q, prop(req), kind, req.params.id)), kind, req.params.id) });
  }));
}
module.exports = mount;
module.exports.logic = { approve, reject, loadPending, KINDS };
