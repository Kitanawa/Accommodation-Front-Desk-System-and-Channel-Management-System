// M17 + M18 (S133 to S138, S142, S145): manager approval inbox.  M19 (S150, S151) rules.  M21 + M22 (S166 to S175, S177 to S180): guest booking engine.
process.env.HOLD_SWEEP_SECONDS = '1';
process.env.PUBLIC_LIMIT_BOOK = '1000'; process.env.PUBLIC_LIMIT_READ = '1000';        // the real limits are 20 and 120 a minute; one test lowers it on purpose
const crypto = require('crypto');
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
  await db.q("insert into users(property_id,role_id,full_name,email,password_hash,can_approve_rates) values((select property_id from users where email='manager@fds.test'),2,'Approving Manager','mgr.ok@fds.test',$1,true)", [await hashPassword('Cedar-Demo-2026')]);
  tok.mgrok = (await api('POST', '/api/login', { email: 'mgr.ok@fds.test', password: 'Cedar-Demo-2026' })).body.token;
  const t = S.today(), D = n => S.addDays(t, n), FD = 'frontdesk', MG = 'manager', AD = 'admin', MO = 'mgrok';
  const code = r => r.body && r.body.error && r.body.error.code;
  const fields = r => ((r.body.error || {}).fields || []).map(f => f.field).sort().join();
  const near = (a, b) => Math.abs(a - b) < 0.006;
  const nrows = async (sql, p) => (await db.q(sql, p))[0].n;
  const propId = (await db.q("select property_id from users where email='admin@fds.test'"))[0].property_id;
  const cats = (await api('GET', '/api/room-categories', null, MG)).body;
  const newType = async (name, rate = 250) => (await api('POST', '/api/room-types', { category_id: cats[0].category_id, name, max_guests: 2, min_nights: 1, rates: [{ rule_type: 'BASE', rate_amount: rate }] }, MG)).body.room_type_id;
  const newAddOn = async (name, price = 20) => (await api('POST', '/api/add-ons', { name, pricing_unit: 'PER_STAY', unit_price: price }, MG)).body.add_on_id;
  const pending = async (who = AD, qs = '') => (await api('GET', '/api/approvals' + qs, null, who)).body;

  // ================= S133 / S142 who may use the approval API =================
  const probe = [['GET', '/api/approvals'], ['GET', '/api/approvals/summary'], ['GET', `/api/approvals/ADD_ON/${crypto.randomUUID()}`], ['POST', `/api/approvals/ADD_ON/${crypto.randomUUID()}/approve`], ['POST', `/api/approvals/ADD_ON/${crypto.randomUUID()}/reject`]];
  let allFD = true, allMG = true, allNone = true;
  for (const [m, u] of probe) { const bd = m === 'POST' ? {} : null; if ((await api(m, u, bd, FD)).status !== 403) allFD = false; if ((await api(m, u, bd, MG)).status !== 403) allMG = false; if ((await api(m, u, bd, undefined)).status !== 401) allNone = false; }
  ok(allFD, 'S142: Front Desk is refused (403) on every approval endpoint: list, summary, detail, approve, reject');
  ok(allMG, 'S133: a Manager who was not given the right to approve is refused on every approval endpoint');
  ok(allNone, 'S133: no token gets 401 on every approval endpoint');
  ok((await api('GET', '/api/approvals', null, MO)).status === 200 && (await api('GET', '/api/approvals', null, AD)).status === 200, 'S133: Administrator and an approving Manager are allowed');
  const exp = (await api('POST', '/api/login', { email: 'mgr.ok@fds.test', password: 'Cedar-Demo-2026' })).body.token;
  await api('POST', '/api/logout', {}, exp);
  const rv = await api('GET', '/api/approvals', null, exp);
  ok(rv.status === 401 && code(rv) === 'SESSION_REVOKED', 'S133: a session ended by logout is refused with SESSION_REVOKED (the app must sign in again)');
  await db.q("update users set can_approve_rates=false where email='mgr.ok@fds.test'");
  ok((await api('GET', '/api/approvals', null, MO)).status === 403, 'S133: taking the right away works at once, also for a session already open');
  await db.q("update users set can_approve_rates=true where email='mgr.ok@fds.test'");

  // ================= S134 pending list and detail =================
  const seed0 = (await pending()).length, seedRate = (await pending()).filter(x => x.kind === 'RATE').length;       // the demo data already has a rate waiting
  const rtId = await newType('Inbox Loft'), aoId = await newAddOn('Inbox Breakfast', 25);
  const base = (await api('GET', '/api/rates', null, AD)).body.find(r => r.rule_type === 'BASE' && r.approval_status === 'APPROVED' && r.in_force);
  const rv1 = await api('POST', `/api/rates/${base.rate_rule_id}/revise`, { rate_amount: Number(base.rate_amount) + 10 }, MG);
  const list = await pending();
  const kinds = list.map(x => x.kind).sort().join();
  ok(list.length === 3 + seed0 && list.filter(x => x.kind === 'ADD_ON').length === 1 && list.filter(x => x.kind === 'ROOM_TYPE').length === 1 && list.filter(x => x.kind === 'RATE').length === 1 + seedRate && list.every(x => x.status === 'PENDING' && x.revision && x.title && x.summary && x.decision === null), 'S134: the list holds the new room type, the rate change and the new add-on (and the one rate the demo data has waiting), each with a title, summary and revision');
  ok(list.filter(x => x.kind === 'RATE').length === 1 + seedRate, 'S134: the rates of a pending room type are not listed apart: they are decided with the room type');
  const sm = (await api('GET', '/api/approvals/summary', null, AD)).body;
  ok(sm.pending === 3 + seed0 && sm.by_kind.ROOM_TYPE === 1 && sm.by_kind.RATE === 1 + seedRate && sm.by_kind.ADD_ON === 1 && sm.oldest_submitted_at, 'S134: the summary counts pending requests by kind');
  ok((await pending(AD, '?kind=add_on')).length === 1 && fields(await api('GET', '/api/approvals?status=DONE&kind=X&limit=0', null, AD)) === 'kind,limit,status', 'S134: the list can be filtered by kind; wrong filters are reported');
  const dt = (await api('GET', `/api/approvals/ROOM_TYPE/${rtId}`, null, AD)).body;
  ok(dt.details.name === 'Inbox Loft' && dt.details.rates.length === 1 && dt.details.rates[0].rate_amount === 250 && dt.summary.includes('250.00'), 'S134: the detail of a room type shows its rates');
  const dr = (await api('GET', `/api/approvals/RATE/${rv1.body.rate_rule_id}`, null, AD)).body;
  ok(dr.details.current_rate === Number(base.rate_amount) && dr.details.rate_amount === Number(base.rate_amount) + 10 && dr.title.startsWith('Rate change'), 'S134: the detail of a rate change shows the current and the new rate');
  const da = (await api('GET', `/api/approvals/ADD_ON/${aoId}`, null, AD)).body;
  ok(da.details.is_new && da.details.unit_price === 25, 'S134: the detail of a new add-on');
  ok((await api('GET', `/api/approvals/ROOM_TYPE/${rtId}`, null, 'badmin')).status === 404 && (await pending('badmin')).length === 0 && (await api('GET', '/api/approvals/summary', null, 'badmin')).body.pending === 0, 'S134: another property sees nothing and gets 404');
  ok(fields(await api('GET', `/api/approvals/FOOD/${aoId}`, null, AD)) === 'kind' && fields(await api('GET', '/api/approvals/ADD_ON/nope', null, AD)) === 'id' && (await api('GET', `/api/approvals/ADD_ON/${crypto.randomUUID()}`, null, AD)).status === 404, 'S134: unknown kind, bad id and unknown request are reported');

  // ================= S135 / S137 approve and reject =================
  const stale = await api('POST', `/api/approvals/ROOM_TYPE/${rtId}/approve`, { revision: 'old-version' }, AD);
  ok(stale.status === 409 && code(stale) === 'STALE_REQUEST' && (await pending()).length === 3 + seed0, 'S138: an approval with an old revision is refused (STALE_REQUEST) and nothing changes');
  await api('PATCH', `/api/add-ons/${aoId}`, { unit_price: 30 }, MG);
  ok(code(await api('POST', `/api/approvals/ADD_ON/${aoId}/approve`, { revision: da.revision }, AD)) === 'STALE_REQUEST', 'S138: the manager opened the add-on at 25, it was changed to 30 meanwhile: approving what he saw is refused');
  const da2 = (await api('GET', `/api/approvals/ADD_ON/${aoId}`, null, AD)).body;
  ok(da2.details.unit_price === 30 && da2.revision !== da.revision, 'S138: opening it again shows the new price and a new revision');
  const ap = await api('POST', `/api/approvals/ROOM_TYPE/${rtId}/approve`, { revision: dt.revision }, AD);
  ok(ap.status === 200 && ap.body.status === 'APPROVED' && ap.body.decision.decided_by === 'Administrator' && (await db.q('select approval_status s from room_types where room_type_id=$1', [rtId]))[0].s === 'APPROVED' && await nrows("select count(*)::int n from rate_rules where room_type_id=$1 and approval_status='APPROVED'", [rtId]) === 1, 'S135: approving a room type approves it and its rate in one step, by the same rules as the desktop');
  const inRates = (await api('GET', '/api/rates', null, FD)).body;
  ok(inRates.some(r => r.room_type === 'Inbox Loft' && r.rate_amount === 250), 'S135: Front Desk sees the new rate at once');
  const rate2 = await api('POST', `/api/approvals/RATE/${rv1.body.rate_rule_id}/approve`, {}, MO);
  ok(rate2.status === 200 && (await db.q('select valid_until::text v from rate_rules where rate_rule_id=$1', [base.rate_rule_id]))[0].v === t, 'S135: approving a rate change ends the old rate today and the new one takes over');
  const ad2 = await api('POST', `/api/approvals/ADD_ON/${aoId}/approve`, { revision: da2.revision }, AD);
  ok(ad2.status === 200 && (await api('GET', '/api/add-ons', null, FD)).body.some(a => a.name === 'Inbox Breakfast' && a.unit_price === 30), 'S135: approving an add-on makes it available');
  const hist = await pending(AD, '?status=approved');
  ok(hist.length === 3 && hist.every(h => h.decision.decided_by && h.decision.decided_at) && hist.some(h => h.decision.decided_by === 'Approving Manager'), 'S137: approved requests stay in the history with who decided and when');
  ok(await nrows("select count(*)::int n from audit_records where action in ('APPROVAL_DECIDED','ROOM_TYPE_APPROVED','RATE_APPROVED','ADD_ON_APPROVED') and user_id is not null") >= 6, 'S137: each decision is also in the audit trail');
  // rejection
  const rt2 = await newType('Rejected Loft', 99), ao2 = await newAddOn('Rejected Spa', 80);
  ok(fields(await api('POST', `/api/approvals/ROOM_TYPE/${rt2}/reject`, {}, AD)) === 'reason' && fields(await api('POST', `/api/approvals/ROOM_TYPE/${rt2}/reject`, { reason: 'no' }, AD)) === 'reason', 'S137: a rejection needs a reason of 3 to 300 characters');
  const rj = await api('POST', `/api/approvals/ROOM_TYPE/${rt2}/reject`, { reason: 'Rate is too low for this room' }, MO);
  ok(rj.status === 200 && rj.body.status === 'REJECTED' && rj.body.decision.reason === 'Rate is too low for this room' && rj.body.decision.decided_by === 'Approving Manager' && await nrows('select count(*)::int n from room_types where room_type_id=$1', [rt2]) === 0, 'S137: a rejected room type is taken away and the reason, approver and time are kept');
  const rejHist = await pending(AD, '?status=REJECTED');
  ok(rejHist.length === 1 && rejHist[0].title === 'New room type: Rejected Loft' && rejHist[0].details.rates[0].rate_amount === 99, 'S137: the history keeps a copy of what was rejected');
  ok(await nrows("select count(*)::int n from audit_records where action='APPROVAL_REJECTED' and new_values->>'reason'='Rate is too low for this room'") === 1, 'S137: the reason is in the audit trail');
  const rjAddon = await api('POST', `/api/approvals/ADD_ON/${ao2}/reject`, { reason: 'Not offered here' }, AD);
  ok(rjAddon.status === 200 && (await api('GET', '/api/add-ons', null, AD)).body.every(a => a.name !== 'Rejected Spa'), 'S137: a rejected new add-on is removed');
  const pr = (await api('PATCH', `/api/add-ons/${aoId}`, { unit_price: 45 }, MG));
  const rjPrice = await api('POST', `/api/approvals/ADD_ON/${aoId}/reject`, { reason: 'Too expensive' }, AD);
  ok(pr.status === 200 && rjPrice.status === 200 && (await api('GET', '/api/add-ons', null, AD)).body.find(a => a.add_on_id === aoId).unit_price === 30 && (await api('GET', '/api/add-ons', null, AD)).body.find(a => a.add_on_id === aoId).pending_unit_price === null, 'S137: rejecting a price change keeps the approved price (30) and clears the pending one');
  // S138 already decided
  ok(code(await api('POST', `/api/approvals/ROOM_TYPE/${rt2}/approve`, {}, AD)) === 'INVALID_STATE' && /already rejected by Approving Manager/.test((await api('POST', `/api/approvals/ROOM_TYPE/${rt2}/approve`, {}, AD)).body.error.message), 'S138: approving a request that was rejected is refused and says by whom');
  ok(code(await api('POST', `/api/approvals/ROOM_TYPE/${rtId}/approve`, {}, AD)) === 'INVALID_STATE' && code(await api('POST', `/api/approvals/ROOM_TYPE/${rtId}/reject`, { reason: 'late change of mind' }, AD)) === 'INVALID_STATE', 'S138: an approved request cannot be approved or rejected again');
  ok((await api('POST', `/api/approvals/ADD_ON/${crypto.randomUUID()}/approve`, {}, AD)).status === 404 && (await api('POST', `/api/approvals/ADD_ON/${ao2}/approve`, {}, 'badmin')).status === 404, 'S138: an unknown request, or one of another property, is 404');
  ok((await api('GET', `/api/approvals/ROOM_TYPE/${rt2}`, null, AD)).body.status === 'REJECTED', 'S138: the detail of a decided request shows the decision');
  ok(await nrows("select count(*)::int n from approval_decisions where subject_id=$1", [rtId]) === 1, 'S138: the repeated attempts left exactly one decision record');

  // ================= S145 repeated taps and simultaneous decisions =================
  const ao3 = await newAddOn('Tap Test', 10);
  const taps = await Promise.all(Array.from({ length: 6 }, () => api('POST', `/api/approvals/ADD_ON/${ao3}/approve`, {}, AD)));
  ok(taps.filter(r => r.status === 200).length === 1 && taps.filter(r => r.status === 409).length === 5 && await nrows('select count(*)::int n from approval_decisions where subject_id=$1', [ao3]) === 1, 'S145: six taps on Approve at once: one is applied, five are refused, one decision record');
  const rt3 = await newType('Race Loft', 120);
  const race = await Promise.all([api('POST', `/api/approvals/ROOM_TYPE/${rt3}/approve`, {}, AD), api('POST', `/api/approvals/ROOM_TYPE/${rt3}/reject`, { reason: 'Two managers disagree' }, MO)]);
  const won = race.filter(r => r.status === 200), lost = race.filter(r => r.status !== 200);
  const state = (await db.q('select approval_status s from room_types where room_type_id=$1', [rt3]))[0];
  ok(won.length === 1 && lost.length === 1 && lost[0].status === 409 && await nrows('select count(*)::int n from approval_decisions where subject_id=$1', [rt3]) === 1 && ((won[0].body.status === 'APPROVED' && state && state.s === 'APPROVED') || (won[0].body.status === 'REJECTED' && !state)), 'S145: Approve and Reject at the same moment: one wins, the other is refused, and the data agrees with the winner');
  const ao4 = await newAddOn('Price Race', 10); await api('POST', `/api/approvals/ADD_ON/${ao4}/approve`, {}, AD); await api('PATCH', `/api/add-ons/${ao4}`, { unit_price: 12 }, MG);
  const pr4 = (await api('GET', `/api/approvals/ADD_ON/${ao4}`, null, AD)).body;
  const dbl = await Promise.all([api('POST', `/api/approvals/ADD_ON/${ao4}/approve`, { revision: pr4.revision }, AD), api('POST', `/api/approvals/ADD_ON/${ao4}/approve`, { revision: pr4.revision }, MO)]);
  ok(dbl.map(r => r.status).sort().join() === '200,409' && (await api('GET', '/api/add-ons', null, AD)).body.find(a => a.add_on_id === ao4).unit_price === 12, 'S145: two managers approve the same price change: applied once (12)');
  const old = await api('POST', `/api/add-ons/${ao3}/approve`, {}, AD);
  ok(old.status === 409 && code(old) === 'INVALID_STATE', 'S145: the desktop approve endpoint also refuses an already decided request');
  await api('PATCH', `/api/add-ons/${ao4}`, { unit_price: 14 }, MG);
  await api('POST', `/api/add-ons/${ao4}/approve`, {}, AD);
  ok(await nrows("select count(*)::int n from approval_decisions where subject_id=$1 and decision='APPROVED'", [ao4]) === 3, 'S137: decisions made on the desktop endpoints are recorded too (one history for both apps)');
  ok((await pending()).length === seed0, 'S134: nothing new is left pending after all decisions');

  // ================= guest booking engine =================
  const types = (await api('GET', '/api/room-types', null, FD)).body;
  const twin = types.find(x => x.name === 'Standard Twin').room_type_id, deluxe = types.find(x => x.name === 'Deluxe King').room_type_id, suite = types.find(x => x.name === 'Family Suite').room_type_id;
  await db.q("insert into room_stock(room_type_id,stock_date,total_rooms) select t.room_type_id, d::date, (select count(*) from rooms r where r.room_type_id=t.room_type_id) from room_types t cross join generate_series($1::date, $2::date, interval '1 day') d where t.room_type_id in ($3,$4,$5) on conflict do nothing", [D(121), D(260), twin, deluxe, suite]);       // the demo data has stock for 120 days; these checks use later dates too
  const SECRET = 'dev-webhook-secret';
  const hook = (o, sigOverride) => { const raw = typeof o === 'string' ? o : JSON.stringify(o); return api('POST', '/api/public/payments/webhook', raw, undefined, { 'X-Signature': sigOverride ?? crypto.createHmac('sha256', SECRET).update(raw).digest('hex') }); };
  const pub = (m, u, b, token) => api(m, u, b, undefined, token ? { 'X-Booking-Token': token } : {});
  const stay = (typeId, from, to, extra = {}) => ({ property_id: propId, room_type_id: typeId, check_in: from, check_out: to, total_guests: 2, guest: { full_name: 'Web Guest', email: `web${Math.random().toString(36).slice(2, 8)}@example.com`, phone: '+60 12-345 6789' }, ...extra });
  const start = async (typeId, from, to, extra) => { const r = await pub('POST', '/api/public/bookings', stay(typeId, from, to, extra)); return { r, id: r.body.attempt_id, token: r.body.access_token, body: r.body }; };
  const payStart = async a => (await pub('POST', `/api/public/bookings/${a.id}/payment-session`, {}, a.token)).body;
  let evn = 0; const evId = () => 'evt-' + (++evn) + '-' + Math.random().toString(36).slice(2, 6);
  const succeed = (sess, over = {}) => hook({ event_id: evId(), type: 'payment.succeeded', reference: sess.reference, amount: sess.amount, currency: sess.currency_code, transaction_id: 'tx-' + Math.random().toString(36).slice(2, 10), ...over });
  const fail = (sess, over = {}) => hook({ event_id: evId(), type: 'payment.failed', reference: sess.reference, ...over });
  const att = async id => (await db.q('select * from booking_attempts where attempt_id=$1', [id]))[0];
  const reserved = async (typeId, from, to) => (await db.q('select string_agg(reserved_rooms::text, \',\' order by stock_date) v from room_stock where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [typeId, from, to]))[0].v;
  const holdOf = async id => (await db.q('select h.status from reservation_holds h join booking_attempts a using(hold_id) where a.attempt_id=$1', [id]))[0].status;

  // ---------- S166 / S167 public availability ----------
  const av = await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(42)}&guests=2`);
  ok(av.status === 200 && av.body.property.name && av.body.property.currency_code === 'MYR' && av.body.room_types.length >= 3, 'S166: availability needs no sign-in');
  const keys = new Set(av.body.room_types.flatMap(x => Object.keys(x))), blob = JSON.stringify(av.body);
  ok(!['rooms_total', 'layout_info', 'reservation_id', 'guest', 'email', 'phone'].some(k => keys.has(k)) && !/full_name|@fds\.test|R-[A-Z0-9]{6}/.test(blob), 'S166: the answer holds no guest data, no booking references and no stock internals');
  ok(av.body.room_types.every(x => x.rooms_left <= 5), 'S166: rooms left is shown up to 5 only (5 means 5 or more)');
  ok(fields(await pub('GET', `/api/public/availability?from=${D(40)}&to=${D(42)}`)) === 'property_id' && (await pub('GET', `/api/public/availability?property_id=${crypto.randomUUID()}&from=${D(40)}&to=${D(42)}`)).status === 404 && fields(await pub('GET', `/api/public/availability?property_id=${propId}&from=2020-01-01&to=nope`)) === 'check_out', 'S166: the property is needed (two exist), unknown property is 404, bad dates are reported');
  const hidden = await newType('Hidden Loft', 310);
  const av2 = await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(42)}`);
  ok(!av2.body.room_types.some(x => x.name === 'Hidden Loft'), 'S167: a room type that is still waiting for approval is not offered');
  await db.q("insert into room_stock(room_type_id,stock_date,total_rooms,reserved_rooms) select $1, d::date, 2, 0 from generate_series($2::date, $3::date, interval '1 day') d", [hidden, D(0), D(120)]).catch(() => {});
  await api('POST', `/api/approvals/ROOM_TYPE/${hidden}/approve`, {}, AD);
  const av3 = (await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(42)}`)).body.room_types.find(x => x.name === 'Hidden Loft');
  ok(av3 && av3.subtotal === 620 && av3.nightly.length === 2 && av3.nightly.every(n => n.rate === 310), 'S167: once approved it is offered at its approved rate (2 x 310)');
  const bdl = (await api('GET', '/api/rates', null, AD)).body.find(r => r.room_type === 'Deluxe King' && r.rule_type === 'BASE' && r.in_force);
  const pricedBefore = (await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(41)}&room_type_id=${deluxe}`)).body.room_types[0].subtotal;
  await api('POST', `/api/rates/${bdl.rate_rule_id}/revise`, { rate_amount: Number(bdl.rate_amount) + 100 }, MG);
  const pricedAfter = (await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(41)}&room_type_id=${deluxe}`)).body.room_types[0].subtotal;
  const staffSees = (await api('GET', `/api/availability?from=${D(40)}&to=${D(41)}&room_type_id=${deluxe}`, null, FD)).body[0].total;
  ok(pricedBefore === pricedAfter && pricedAfter === staffSees, 'S167: a rate change that is still pending changes no price; the website shows the same price as the front desk');
  await api('POST', '/api/approvals/RATE/' + (await pending(AD, '?kind=rate')).find(x => x.details.room_type === 'Deluxe King').id + '/approve', {}, AD);
  await api('PATCH', '/api/settings', { tax_name: 'SST', tax_rate_pct: 6 }, MG);
  const avTax = (await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(41)}&room_type_id=${twin}`)).body.room_types[0];
  ok(avTax.tax_rate_pct === 6 && near(avTax.tax_total, avTax.subtotal * 0.06) && near(avTax.total, avTax.subtotal * 1.06), 'S167: the public price includes the tax of the property (6%)');

  // ---------- S168 / S169 booking attempt ----------
  const bad1 = await pub('POST', '/api/public/bookings', { property_id: propId, check_in: D(1), check_out: D(1), total_guests: 0, guest: 'x', total: 1, amount: 1, price: 1 });
  ok(bad1.status === 400 && fields(bad1) === 'amount,check_out,guest.email,guest.full_name,price,room_type_id,total,total_guests', 'S169: every wrong or forbidden field is reported (prices from the client are refused)');
  ok(fields(await pub('POST', '/api/public/bookings', stay(twin, D(40), D(41), { guest: { full_name: 'A', email: 'not an email', phone: 'call me' }, special_requests: 'x'.repeat(501), total_guests: '2' }))) === 'guest.email,guest.full_name,guest.phone,special_requests,total_guests', 'S169: name, e-mail, phone, requests and a guest count given as text are refused');
  ok(fields(await pub('POST', '/api/public/bookings', stay(twin, D(-2), D(40)))) === 'check_in' && fields(await pub('POST', '/api/public/bookings', stay(twin, D(40), D(135)))) === 'check_out', 'S169: a past check-in and a stay of more than 90 nights are refused');
  ok(fields(await pub('POST', '/api/public/bookings', stay(twin, D(40), D(41), { total_guests: 9 }))) === 'total_guests', 'S169: more guests than the room type allows is refused');
  const p2type = (await db.q('select t.room_type_id from room_types t join room_categories c using(category_id) where c.property_id=$1 limit 1', [p2.property_id]))[0].room_type_id;
  ok((await pub('POST', '/api/public/bookings', stay(p2type, D(40), D(41)))).status === 404 && (await pub('POST', '/api/public/bookings', stay(crypto.randomUUID(), D(40), D(41)))).status === 404, 'S169: a room type of another property, or unknown, is 404');
  ok((await pub('POST', '/api/public/bookings', stay(hidden, D(40), D(41)))).status === 201, 'S167: the room type approved a moment ago can be booked');
  ok((await pub('POST', '/api/public/bookings', 'not json')).status === 400, 'S169: a body that is not JSON is refused');
  const before = await reserved(twin, D(40), D(42));
  const mis = await pub('POST', '/api/public/bookings', stay(twin, D(40), D(42), { expected_total: 1 }));
  ok(mis.status === 409 && code(mis) === 'PRICE_CHANGED' && await reserved(twin, D(40), D(42)) === before, 'S169: if the guest saw another price the server refuses and holds nothing');
  const a1 = await start(twin, D(40), D(42), { expected_total: Number((av.body.room_types.find(x => x.room_type_id === twin).subtotal * 1.06).toFixed(2)) });
  ok(a1.r.status === 201 && a1.body.status === 'HOLDING' && /^[0-9a-f]{48}$/.test(a1.token) && a1.body.price.total === av.body.room_types.find(x => x.room_type_id === twin).subtotal * 1.06 && a1.body.price.amount_due === a1.body.price.total && near(a1.body.price.tax_total, a1.body.price.subtotal * 0.06), 'S168/S169: a booking attempt is created with the price calculated on the server (tax included) and a private token');
  const lines = a1.body.price.nights;
  ok(lines.length === 2 && near(lines.reduce((x, n) => x + n.rate, 0), a1.body.price.subtotal), 'S169: the nightly prices add up to the subtotal');
  const ar = await att(a1.id), minutes = (new Date(ar.expires_at) - Date.now()) / 60000;
  ok(minutes > 14 && minutes <= 15 && await holdOf(a1.id) === 'ACTIVE' && await reserved(twin, D(40), D(42)) !== before, 'S168: the attempt holds the room for the hold time of the property (15 minutes) and takes stock at once');
  ok((await pub('GET', `/api/public/bookings/${a1.id}`)).status === 401 && (await pub('GET', `/api/public/bookings/${a1.id}`, null, 'f'.repeat(48))).status === 404 && (await pub('GET', `/api/public/bookings/${a1.id}`, null, a1.token)).status === 200, 'S168: the attempt is read with its token only (no token 401, wrong token 404)');
  const gv = (await pub('GET', `/api/public/bookings/${a1.id}`, null, a1.token)).body;
  ok(!JSON.stringify(gv).includes(ar.token_hash) && gv.guest.email === ar.guest_email && gv.status === 'HOLDING', 'S168: the stored token hash is never shown');
  const e3 = 'three@example.com';
  for (let i = 0; i < 3; i++) await start(twin, D(60 + i * 3), D(61 + i * 3), { guest: { full_name: 'Three Tries', email: e3 } });
  const e4 = await pub('POST', '/api/public/bookings', stay(twin, D(80), D(81), { guest: { full_name: 'Three Tries', email: e3 } }));
  ok(e4.status === 429 && code(e4) === 'RATE_LIMITED', 'S168: a fourth unpaid attempt with the same e-mail is refused (a hold must not be hoarded)');
  await api('PATCH', '/api/settings', { online_deposit_pct: 50 }, MG);
  const aDep = await start(twin, D(90), D(91));
  ok(aDep.body.price.amount_due === Math.round(aDep.body.price.total * 50) / 100 && aDep.body.price.deposit_pct === 50, 'S150: with the setting "online deposit 50%" the amount due online is half');
  await api('PATCH', '/api/settings', { online_deposit_pct: 100 }, MG);
  ok(fields(await api('PATCH', '/api/settings', { online_deposit_pct: 0, free_cancellation_hours: -1, late_cancel_fee_pct: 101 }, MG)) === 'free_cancellation_hours,late_cancel_fee_pct,online_deposit_pct' && (await api('PATCH', '/api/settings', { late_cancel_fee_pct: 10 }, FD)).status === 403, 'S150: the online deposit and cancellation settings are validated and only management changes them');
  ok(fields(await api('PATCH', '/api/settings', { hold_minutes: 0 }, MG)) === 'hold_minutes', 'S151: the hold time (which is also the time to pay) is 1 to 60 minutes');

  // ---------- S170 payment session ----------
  ok((await pub('POST', `/api/public/bookings/${a1.id}/payment-session`, {})).status === 401 && (await pub('POST', `/api/public/bookings/${a1.id}/payment-session`, {}, 'a'.repeat(48))).status === 404, 'S170: a payment session needs the booking token');
  const ps = await pub('POST', `/api/public/bookings/${a1.id}/payment-session`, { amount: 1, reference: 'MINE', currency_code: 'USD' }, a1.token);
  ok(ps.status === 201 && /^PS-[0-9A-F]{16}$/.test(ps.body.reference) && ps.body.amount === a1.body.price.amount_due && ps.body.currency_code === 'MYR' && ps.body.payment_url.includes(ps.body.reference), 'S170: the session has the amount, currency and reference chosen by the server; what the client sends is ignored');
  const ps2 = await pub('POST', `/api/public/bookings/${a1.id}/payment-session`, {}, a1.token);
  ok(ps2.body.reference === ps.body.reference && await nrows('select count(*)::int n from payment_sessions where attempt_id=$1', [a1.id]) === 1 && (await att(a1.id)).status === 'PAYMENT_PENDING', 'S170: asking again returns the same session (one open session per booking)');
  const sess1 = ps.body;

  // ---------- S171 webhook authenticity and amount ----------
  const okEv = { event_id: evId(), type: 'payment.succeeded', reference: sess1.reference, amount: sess1.amount, currency: sess1.currency_code, transaction_id: 'tx-a1' };
  ok((await api('POST', '/api/public/payments/webhook', JSON.stringify(okEv))).status === 401 && code(await hook(okEv, 'abc')) === 'INVALID_SIGNATURE' && code(await hook(okEv, 'sha256=' + crypto.createHmac('sha256', 'wrong').update(JSON.stringify(okEv)).digest('hex'))) === 'INVALID_SIGNATURE', 'S171: no signature, a wrong signature and a signature made with another secret are refused (401)');
  const signed = crypto.createHmac('sha256', SECRET).update(JSON.stringify(okEv)).digest('hex');
  ok(code(await hook({ ...okEv, amount: 1 }, signed)) === 'INVALID_SIGNATURE' && (await att(a1.id)).status === 'PAYMENT_PENDING', 'S171: a body changed after signing is refused and nothing happens');
  ok(fields(await hook({ event_id: '', type: 'refund', reference: 5 })) === 'event_id,reference,type' && fields(await hook({ event_id: 'e', type: 'payment.succeeded', reference: 'PS-X', amount: -1, currency: 'MY' })) === 'amount,currency', 'S171: a signed body with wrong fields is reported');
  ok((await hook({ event_id: evId(), type: 'payment.succeeded', reference: 'PS-UNKNOWN', amount: 1, currency: 'MYR' })).status === 404, 'S171: an unknown reference is 404');
  const w1 = await succeed(sess1, { amount: sess1.amount - 1 });
  ok(w1.status === 409 && code(w1) === 'PAYMENT_MISMATCH' && (await att(a1.id)).status === 'PAYMENT_PENDING' && (await att(a1.id)).reservation_id === null, 'S171: a payment of another amount is refused (PAYMENT_MISMATCH) and the booking stays unpaid');
  ok(code(await succeed(sess1, { currency: 'USD' })) === 'PAYMENT_MISMATCH' && await nrows("select count(*)::int n from payment_events where reference=$1 and outcome='REJECTED'", [sess1.reference]) === 2, 'S171: another currency is refused too; both are recorded');
  ok((await api('GET', '/api/me/notifications', null, MG)).body.some(n => n.event_code === 'BOOKING_PAYMENT_PROBLEM' && n.subject.includes(sess1.reference)), 'S171: the managers are told about a payment that does not match');
  // ---------- S172 confirm after verified payment ----------
  const resBefore = await nrows('select count(*)::int n from reservations');
  const stockBefore = await reserved(twin, D(40), D(42));
  const w2 = await hook(okEv);
  ok(w2.status === 200 && w2.body.status === 'APPLIED' && /^R-/.test(w2.body.reservation_ref) && w2.body.late === false, 'S172: a verified payment of the right amount confirms the booking');
  const rsv = (await db.q('select r.*, s.name source from reservations r join booking_sources s using(source_id) where reservation_ref=$1', [w2.body.reservation_ref]))[0];
  ok(rsv.status === 'CONFIRMED' && rsv.source === 'Direct website' && rsv.payment_status === 'PAID' && (await att(a1.id)).status === 'CONFIRMED' && await holdOf(a1.id) === 'CONFIRMED' && await reserved(twin, D(40), D(42)) === stockBefore, 'S172: reservation CONFIRMED, source Direct website, PAID; the hold became the reservation; stock not taken twice');
  const gf = (await api('GET', `/api/reservations/${rsv.reservation_id}`, null, FD)).body;
  ok(gf.total_charges === a1.body.price.total && gf.total_paid === a1.body.price.total && gf.balance === 0 && gf.payments.length === 1 && gf.payments[0].method === 'ONLINE' && gf.full_name === 'Web Guest' && gf.email === ar.guest_email, 'S172: the folio total equals the price shown to the guest; one online payment; the guest data is stored');
  ok((await api('GET', `/api/reservations?q=${rsv.reservation_ref}`, null, FD)).body.length === 1 && (await api('GET', `/api/reservations?source_id=4`, null, FD)).body.some(x => x.reservation_ref === rsv.reservation_ref), 'S174: the booking is visible to the front desk (search by reference, filter by source Direct website)');
  const dup = await hook(okEv);
  ok(dup.status === 200 && dup.body.status === 'DUPLICATE' && await nrows('select count(*)::int n from reservations') === resBefore + 1 && await nrows('select count(*)::int n from payments where folio_id=(select folio_id from folios where reservation_id=$1)', [rsv.reservation_id]) === 1, 'S172: the same event again changes nothing (200 DUPLICATE)');
  const again = await succeed(sess1);
  ok(again.status === 200 && again.body.status === 'IGNORED' && await nrows('select count(*)::int n from reservations') === resBefore + 1, 'S172: another success event for a session already paid is ignored');
  const lateFail = await fail(sess1);
  ok(lateFail.body.status === 'IGNORED' && (await att(a1.id)).status === 'CONFIRMED' && await holdOf(a1.id) === 'CONFIRMED', 'S173: a failure event that arrives after the payment does not undo the booking');
  // S174 mail
  const mail = await db.q('select * from email_outbox where reservation_id=$1', [rsv.reservation_id]);
  ok(mail.length === 1 && mail[0].status === 'QUEUED' && mail[0].to_email === ar.guest_email && mail[0].subject.includes(rsv.reservation_ref) && mail[0].body.includes(rsv.reservation_ref) && mail[0].body.includes(D(40)), 'S174: one confirmation e-mail is queued (not sent: no mail service exists), also after repeated events');
  ok((await api('GET', '/api/email-outbox?status=QUEUED', null, MG)).body.some(m => m.outbox_id === mail[0].outbox_id) && (await api('GET', '/api/email-outbox', null, FD)).status === 403 && (await api('GET', '/api/email-outbox', null, 'badmin')).body.length === 0 && fields(await api('GET', '/api/email-outbox?status=X', null, MG)) === 'status', 'S174: management sees the queue; Front Desk does not; another property sees nothing');
  ok(await nrows("select count(*)::int n from audit_records where action='ONLINE_BOOKING_CONFIRMED' and entity_id=$1", [rsv.reservation_id]) === 1, 'S174: the online confirmation is in the audit trail');
  // partial payment (deposit)
  await api('PATCH', '/api/settings', { online_deposit_pct: 40 }, MG);
  const aD = await start(deluxe, D(100), D(102)), sD = await payStart(aD);
  const wD = await succeed(sD);
  const rD = (await db.q('select r.reservation_id, r.payment_status from reservations r where reservation_ref=$1', [wD.body.reservation_ref]))[0];
  const fD = (await api('GET', `/api/reservations/${rD.reservation_id}`, null, FD)).body;
  ok(rD.payment_status === 'PARTIAL' && fD.payments[0].kind === 'DEPOSIT' && near(fD.balance, aD.body.price.total - aD.body.price.amount_due), 'S172: with a 40% online deposit the booking is confirmed as PARTIAL, the payment is a DEPOSIT and the rest is the balance');
  await api('PATCH', '/api/settings', { online_deposit_pct: 100 }, MG);
  // the same event ten times at once
  const aR = await start(twin, D(110), D(111)), sR = await payStart(aR), evR = { event_id: evId(), type: 'payment.succeeded', reference: sR.reference, amount: sR.amount, currency: 'MYR', transaction_id: 'tx-race' };
  const resB = await nrows('select count(*)::int n from reservations'), burst = await Promise.all(Array.from({ length: 10 }, () => hook(evR)));
  ok(burst.filter(r => r.body.status === 'APPLIED').length === 1 && burst.filter(r => r.body.status === 'DUPLICATE').length === 9 && await nrows('select count(*)::int n from reservations') === resB + 1 && await nrows("select count(*)::int n from payments where gateway_reference='tx-race'") === 1, 'S179: the same webhook delivered 10 times at once: one booking, one payment, nine DUPLICATE');
  // two different events for one session at once
  const aS = await start(twin, D(112), D(113)), sS = await payStart(aS);
  const two = await Promise.all([succeed(sS), succeed(sS)]);
  ok(two.map(r => r.body.status).sort().join() === 'APPLIED,IGNORED' && await nrows("select count(*)::int n from payments where note=$1", ['Online payment ' + sS.reference]) === 1, 'S179: two different success events for one session at once: one is applied, one ignored');

  // ---------- S173 / S179 failed, abandoned, expired ----------
  const aF = await start(suite, D(120), D(122)), sF = await payStart(aF), stockHeld = await reserved(suite, D(120), D(122));
  const wf = await fail(sF);
  ok(wf.status === 200 && wf.body.status === 'FAILED_APPLIED' && (await att(aF.id)).status === 'FAILED' && await holdOf(aF.id) === 'RELEASED' && await reserved(suite, D(120), D(122)) !== stockHeld, 'S173: a failed payment releases the hold at once and gives the rooms back');
  ok((await fail(sF)).body.status === 'IGNORED', 'S179: a second failure event does nothing more');
  const delayedOk = await succeed(sF);
  const lateRes = delayedOk.body.reservation_ref && (await db.q('select status, payment_status from reservations where reservation_ref=$1', [delayedOk.body.reservation_ref]))[0];
  ok(delayedOk.status === 200 && delayedOk.body.status === 'APPLIED' && delayedOk.body.late === true && lateRes.status === 'CONFIRMED' && lateRes.payment_status === 'PAID' && (await att(aF.id)).status === 'CONFIRMED', 'S179: a payment reported as failed and then, late, as succeeded: the money wins, the room is taken again because it was still free');
  // delayed success when the room is gone
  const aG = await start(suite, D(130), D(132)), sG = await payStart(aG);
  await fail(sG);
  await db.q('update room_stock set reserved_rooms=total_rooms where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [suite, D(130), D(132)]);
  const gone = await succeed(sG);
  ok(gone.status === 200 && gone.body.status === 'UNFULFILLED' && (await att(aG.id)).status === 'PAID_UNFULFILLED' && await nrows("select count(*)::int n from payment_sessions where attempt_id=$1 and status='PAID'", [aG.id]) === 1, 'S179: a payment that arrives when the room is gone is not lost: the booking is marked PAID_UNFULFILLED');
  ok((await api('GET', '/api/me/notifications', null, AD)).body.some(n => n.event_code === 'BOOKING_PAYMENT_PROBLEM' && n.subject.includes(sG.reference)) && await nrows("select count(*)::int n from audit_records where action='ONLINE_PAYMENT_UNFULFILLED'") === 1, 'S179: the managers are told to refund it at the gateway, and it is audited');
  await db.q('update room_stock set reserved_rooms=0 where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [suite, D(130), D(132)]);
  // abandoned
  const aA = await start(twin, D(140), D(142)), sA = await payStart(aA), stockA = await reserved(twin, D(140), D(142));
  ok((await pub('POST', `/api/public/bookings/${aA.id}/cancel`, {}, 'z'.repeat(48))).status === 404 && (await pub('POST', `/api/public/bookings/${aA.id}/cancel`, {})).status === 401, 'S173: only the guest with the token can walk away');
  const ab = await pub('POST', `/api/public/bookings/${aA.id}/cancel`, {}, aA.token);
  ok(ab.status === 200 && ab.body.status === 'ABANDONED' && await holdOf(aA.id) === 'RELEASED' && await reserved(twin, D(140), D(142)) !== stockA && (await db.q('select status from payment_sessions where attempt_id=$1', [aA.id]))[0].status === 'EXPIRED', 'S173: an abandoned payment releases the hold and closes the session');
  ok(code(await pub('POST', `/api/public/bookings/${aA.id}/cancel`, {}, aA.token)) === 'INVALID_STATE' && code(await pub('POST', `/api/public/bookings/${aA.id}/payment-session`, {}, aA.token)) === 'INVALID_STATE', 'S173: an abandoned booking cannot be cancelled again or paid');
  // expiry by the clock, without anybody calling the API
  const aE = await start(twin, D(150), D(152)), sE = await payStart(aE), stockE = await reserved(twin, D(150), D(152));
  await db.q("update reservation_holds set expires_at=now()-interval '1 minute' where hold_id=$1", [aE.id ? (await att(aE.id)).hold_id : null]);
  let swept = false; for (let i = 0; i < 40 && !swept; i++) { await new Promise(r => setTimeout(r, 250)); swept = (await att(aE.id)).status === 'EXPIRED'; }
  ok(swept && await holdOf(aE.id) === 'EXPIRED' && await reserved(twin, D(150), D(152)) !== stockE && (await db.q('select status from payment_sessions where attempt_id=$1', [aE.id]))[0].status === 'EXPIRED', 'S180: an unpaid hold that ran out is expired by the server clock within seconds, with no request from anyone: stock back, session closed');
  ok((await pub('GET', `/api/public/bookings/${aE.id}`, null, aE.token)).body.status === 'EXPIRED' && code(await pub('POST', `/api/public/bookings/${aE.id}/payment-session`, {}, aE.token)) === 'HOLD_EXPIRED', 'S180: the guest sees EXPIRED and cannot start a payment');
  const lateE = await succeed(sE);
  ok(lateE.status === 200 && lateE.body.status === 'APPLIED' && lateE.body.late === true, 'S180: a payment that comes after the expiry, with the room still free, still produces the booking');
  const aN = await start(twin, D(160), D(162)), sN = await payStart(aN);
  await db.q("update reservation_holds set expires_at=now()-interval '1 minute' where hold_id=$1", [(await att(aN.id)).hold_id]);
  const lazy = await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(160)}&to=${D(162)}&room_type_id=${twin}`);
  ok((await att(aN.id)).status === 'EXPIRED', 'S180: a search also expires overdue holds at once (so the count is right before the next timer run)');
  const overdue = await start(twin, D(165), D(166)), sOv = await payStart(overdue);
  await db.q("update reservation_holds set expires_at=now()-interval '1 second' where hold_id=$1", [(await att(overdue.id)).hold_id]);
  await db.q("update booking_attempts set status='PAYMENT_PENDING' where attempt_id=$1", [overdue.id]);
  const edge = await succeed(sOv);
  ok(edge.status === 200 && edge.body.status === 'APPLIED' && edge.body.late === true, 'S180: a payment that arrives a second after the hold ended is handled as a late payment, not lost');

  // ---------- S177 last room: website against front desk ----------
  const left = async (typeId, from, to) => (await pub('GET', `/api/public/availability?property_id=${propId}&from=${from}&to=${to}&room_type_id=${typeId}`)).body.room_types[0].rooms_left;
  const LR = D(200), LR2 = D(202);
  await db.q('update room_stock set reserved_rooms=total_rooms-1 where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [suite, LR, LR2]);
  ok(await left(suite, LR, LR2) === 1, 'S177: one Family Suite is left for the two nights');
  const staffBook = () => api('POST', '/api/reservations', { guest: { full_name: 'Desk Guest' }, room_type_id: suite, check_in: LR, check_out: LR2, total_guests: 2, source_id: 1 }, FD);
  const webBook = () => pub('POST', '/api/public/bookings', stay(suite, LR, LR2));
  const duel = await Promise.all([webBook(), staffBook()]);
  ok(duel.map(r => r.status).sort().join() === '201,409' && duel.find(r => r.status === 409).body.error.code === 'SOLD_OUT' && await reserved(suite, LR, LR2) === (await db.q('select string_agg(total_rooms::text, \',\' order by stock_date) v from room_stock where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [suite, LR, LR2]))[0].v, 'S177: website and front desk press for the last room at the same moment: one gets it, the other SOLD_OUT, and the stock is exactly full');
  await db.q('update room_stock set reserved_rooms=total_rooms-1 where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date', [suite, LR, LR2]);
  await db.q("update reservation_holds set status='RELEASED' where status='ACTIVE' and room_type_id=$1 and check_in_date=$2::date", [suite, LR]);
  const web6 = await Promise.all(Array.from({ length: 6 }, () => webBook()));
  ok(web6.filter(r => r.status === 201).length === 1 && web6.filter(r => r.status === 409).length === 5, 'S177: six guests on the website for the last room at once: exactly one gets it');
  const winner = web6.find(r => r.status === 201);
  ok(code(await staffBook()) === 'SOLD_OUT', 'S177: while the guest is paying the front desk cannot sell the same room');
  await pub('POST', `/api/public/bookings/${winner.body.attempt_id}/cancel`, {}, winner.body.access_token);
  ok((await staffBook()).status === 201, 'S177: when the guest leaves, the front desk can sell it');
  ok(Number((await db.q('select coalesce(sum(case when reserved_rooms>total_rooms or reserved_rooms<0 then 1 else 0 end),0) n from room_stock'))[0].n) === 0, 'S177: no night anywhere is over-booked or negative');
  // stock equals live reservations + live holds for the whole system
  const mism = await db.q(`select s.room_type_id, s.stock_date from room_stock s where s.reserved_rooms <>
      (select count(*) from reservation_rooms rr join reservations r using(reservation_id) where rr.room_type_id=s.room_type_id and r.status in ('CONFIRMED','CHECKED_IN') and r.check_in_date<=s.stock_date and r.check_out_date>s.stock_date)
      + (select count(*) from reservation_holds h where h.room_type_id=s.room_type_id and h.status='ACTIVE' and h.check_in_date<=s.stock_date and h.check_out_date>s.stock_date)
      and s.stock_date>=current_date + 1 and s.room_type_id in ($1,$2) and s.stock_date not between $3::date and $4::date`, [twin, deluxe, D(130), D(132)]);
  ok(mism.length === 0, 'S177: for the room types used here, stock equals live reservations plus live holds on every night');

  // ---------- S178 prices and inputs that do not come from us ----------
  const hostile = await pub('POST', '/api/public/bookings', stay(twin, D(170), D(171), { total: 0.01, subtotal: 0.01, amount_due: 0.01, tax_total: 0, nightly: [{ date: D(170), rate: 1 }] }));
  ok(hostile.status === 400 && fields(hostile) === 'amount_due,nightly,subtotal,tax_total,total', 'S178: total, subtotal, amount_due, tax_total and nightly prices in the request are all refused');
  ok(await nrows("select count(*)::int n from booking_attempts a join reservation_holds h using(hold_id) where a.check_in_date=$1::date and a.room_type_id=$2", [D(170), twin]) === 0, 'S178: a refused request leaves no hold behind');
  const xss = await start(twin, D(172), D(173), { guest: { full_name: '<script>alert(1)</script> Ann', email: 'ann@example.com' }, special_requests: "'; drop table guests; --" });
  ok(xss.r.status === 201 && (await pub('GET', `/api/public/bookings/${xss.id}`, null, xss.token)).body.guest.full_name === '<script>alert(1)</script> Ann' && (await att(xss.id)).special_requests === "'; drop table guests; --" && await nrows("select count(*)::int n from information_schema.tables where table_name='guests'") === 1, 'S178: text with markup or SQL is only ever data: stored and returned as plain text, nothing runs');
  const edgeIn = [stay(twin, D(174), D(175), { total_guests: 1.5 }), stay(twin, D(174), D(175), { total_guests: -1 }), stay(twin, '2026-02-30', '2026-03-02'), stay(twin, D(174), D(175), { guest: { full_name: 'X'.repeat(121), email: 'a@b.co' } }), stay(twin, D(174), D(175), { guest: { full_name: 'Bob', email: 'a'.repeat(170) + '@b.co' } }), stay(twin, D(174), D(175), { room_type_id: 'x' }), stay(twin, D(174), D(175), { property_id: 5 })];
  const edgeRes = await Promise.all(edgeIn.map(b => pub('POST', '/api/public/bookings', b)));
  ok(edgeRes.every(r => r.status === 400), 'S178: fractional or negative guest counts, an impossible date, a too long name or e-mail, a bad room type and a bad property id are all 400');
  const sB = await start(twin, D(176), D(177)), sessB = await payStart(sB);
  ok(code(await succeed(sessB, { amount: 0.01 })) === 'PAYMENT_MISMATCH' && code(await succeed(sessB, { amount: sessB.amount * 10 })) === 'PAYMENT_MISMATCH' && (await att(sB.id)).status === 'PAYMENT_PENDING', 'S178: the gateway result is compared with the session: a lower or a higher amount is refused');
  const sC = await start(twin, D(183), D(184));   // 7 days later = same weekday, so the price is the same on any day the test runs
  const swap = await hook({ event_id: evId(), type: 'payment.succeeded', reference: sessB.reference, amount: sC.body.price.amount_due, currency: 'MYR' });
  ok(swap.status === 200 && (await att(sB.id)).status === 'CONFIRMED' && (await att(sC.id)).status === 'HOLDING', 'S178: a payment confirms only the booking its own reference belongs to: B is confirmed, C stays unpaid');

  // ---------- S175 cancellation and refund ----------
  await api('PATCH', '/api/settings', { free_cancellation_hours: 48, late_cancel_fee_pct: 25 }, MG);
  const pay1 = async (typeId, from, to) => { const a = await start(typeId, from, to), s = await payStart(a), w = await succeed(s); return { a, s, w, ref: w.body.reservation_ref, rid: (await db.q('select reservation_id from reservations where reservation_ref=$1', [w.body.reservation_ref]))[0].reservation_id }; };
  const freeC = await pay1(twin, D(10), D(12)), stockF = await reserved(twin, D(10), D(12));
  const gc = await pub('POST', `/api/public/bookings/${freeC.a.id}/cancel`, {}, freeC.a.token);
  const rf1 = await db.q('select * from refunds where folio_id=(select folio_id from folios where reservation_id=$1)', [freeC.rid]);
  ok(gc.status === 200 && gc.body.status === 'CANCELLED' && gc.body.cancel_fee === 0 && gc.body.free_of_charge === true && gc.body.refund_requested === freeC.a.body.price.total, 'S175: cancelling 10 days ahead is free: the whole payment is asked back');
  ok(rf1.length === 1 && rf1[0].status === 'REQUESTED' && rf1[0].requested_by === null && Number(rf1[0].amount) === freeC.a.body.price.total, 'S175: the refund is a request (nothing is paid out by itself) with no staff member as requester');
  ok((await db.q('select status, cancel_fee::float8 f from reservations where reservation_id=$1', [freeC.rid]))[0].status === 'CANCELLED' && await reserved(twin, D(10), D(12)) !== stockF, 'S175: the reservation is CANCELLED and the nights are back in stock');
  const ar1 = await api('POST', `/api/refunds/${rf1[0].refund_id}/approve`, {}, MG);
  const gf2 = (await api('GET', `/api/reservations/${freeC.rid}`, null, FD)).body;
  ok(ar1.status === 200 && gf2.total_refunded === freeC.a.body.price.total && near(gf2.total_paid - gf2.total_refunded, 0), 'S175: a Manager approves it (the request has no requester, so anybody with the right may): the money is refunded in full');
  ok(await nrows("select count(*)::int n from audit_records where action='RESERVATION_CANCELLED' and entity_id=$1 and new_values->>'via'='GUEST' and (new_values->>'refund_requested')::numeric=$2", [freeC.rid, freeC.a.body.price.total]) === 1, 'S175: the audit record says who/how (guest, online), the fee and the refund asked');
  ok(code(await pub('POST', `/api/public/bookings/${freeC.a.id}/cancel`, {}, freeC.a.token)) === 'INVALID_STATE', 'S175: cancelling twice is refused');
  const lateC = await pay1(twin, D(1), D(2));
  const lc = await pub('POST', `/api/public/bookings/${lateC.a.id}/cancel`, {}, lateC.a.token);
  const lateTotal = lateC.a.body.price.total;
  ok(lc.status === 200 && lc.body.free_of_charge === false && near(lc.body.cancel_fee, lateTotal * 0.25) && near(lc.body.refund_requested, lateTotal * 0.75), 'S175: cancelling inside the 48 hours costs 25% of the total, the other 75% is asked back');
  ok(near((await db.q('select cancel_fee::float8 f from reservations where reservation_id=$1', [lateC.rid]))[0].f, lateTotal * 0.25), 'S175: the fee is kept on the reservation');
  await api('PATCH', '/api/settings', { late_cancel_fee_pct: 100 }, MG);
  const lateC2 = await pay1(twin, D(1), D(2)), lc2 = await pub('POST', `/api/public/bookings/${lateC2.a.id}/cancel`, {}, lateC2.a.token);
  ok(lc2.body.refund_requested === 0 && near(lc2.body.cancel_fee, lateC2.a.body.price.total) && await nrows('select count(*)::int n from refunds where folio_id=(select folio_id from folios where reservation_id=$1)', [lateC2.rid]) === 0, 'S175: with a 100% late fee nothing is refunded and no refund request is made');
  await api('PATCH', '/api/settings', { free_cancellation_hours: 0 }, MG);
  const zero = await pay1(twin, D(1), D(2)), z = await pub('POST', `/api/public/bookings/${zero.a.id}/cancel`, {}, zero.a.token);
  ok(z.body.free_of_charge === true, 'S175: with 0 free hours cancelling before the check-in time is free');
  await api('PATCH', '/api/settings', { free_cancellation_hours: 48, late_cancel_fee_pct: 25 }, MG);
  // staff cancel of a reservation with a cash payment
  const sr = (await api('POST', '/api/reservations', { guest: { full_name: 'Cash Guest' }, room_type_id: twin, check_in: D(20), check_out: D(21), total_guests: 2, source_id: 2 }, FD)).body;
  await api('POST', `/api/reservations/${sr.reservation_id}/payments`, { amount: 100, method: 'CASH' }, FD);
  const sc = await api('POST', `/api/reservations/${sr.reservation_id}/cancel`, { remark: 'Guest called' }, FD);
  const rfS = await db.q('select r.*, u.email from refunds r left join users u on u.user_id=r.requested_by where r.folio_id=(select folio_id from folios where reservation_id=$1)', [sr.reservation_id]);
  ok(sc.status === 200 && sc.body.status === 'CANCELLED' && rfS.length === 1 && Number(rfS[0].amount) === 100 && rfS[0].email === 'frontdesk@fds.test', 'S175: a staff cancellation applies the same rule: the 100 paid is asked back, requested by the Front Desk user');
  ok((await api('POST', `/api/refunds/${rfS[0].refund_id}/approve`, {}, FD)).status === 403 && (await api('POST', `/api/refunds/${rfS[0].refund_id}/approve`, {}, AD)).status === 200, 'S175: Front Desk cannot approve its own request; an Administrator does');
  const un = (await api('POST', '/api/reservations', { guest: { full_name: 'Unpaid Guest' }, room_type_id: twin, check_in: D(22), check_out: D(23), total_guests: 2, source_id: 2 }, FD)).body;
  const unc = await api('POST', `/api/reservations/${un.reservation_id}/cancel`, {}, FD);
  ok(unc.status === 200 && await nrows('select count(*)::int n from refunds where folio_id=(select folio_id from folios where reservation_id=$1)', [un.reservation_id]) === 0, 'S175: an unpaid reservation cancels with no refund request');
  const rf2 = (await api('GET', '/api/refunds?status=REQUESTED', null, MG)).body;
  ok(rf2.every(x => x.status === 'REQUESTED'), 'S175: refund requests from cancellations appear in the refund list for approval');

  // ---------- public limits ----------
  process.env.PUBLIC_LIMIT_READ = '3'; require('../public').resetLimits();
  const lim = []; for (let i = 0; i < 5; i++) lim.push((await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(41)}`)).status);
  ok(lim.join() === '200,200,200,429,429', 'S166: an address that asks too often gets 429 (limit set to 3 a minute for this check)');
  process.env.PUBLIC_LIMIT_READ = '1000'; require('../public').resetLimits();
  ok((await pub('GET', `/api/public/availability?property_id=${propId}&from=${D(40)}&to=${D(41)}`)).status === 200, 'S166: the limit is lifted when the window passes (reset for the test)');
  await api('PATCH', '/api/settings', { tax_rate_pct: 0 }, MG);

  summary();
})().catch(e => { console.error(e); process.exit(1); });
