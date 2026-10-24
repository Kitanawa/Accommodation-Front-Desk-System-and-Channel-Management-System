// S055: the running API follows the contract: identifiers, response errors, request ids, formats.
const { ok, summary, boot, api, tok, DEMO } = require('./helpers');
const { CODES, isUuid } = require('../errors');
const S = require('../service');
const { hashPassword } = require('../password');

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOOKUP_IDS = new Set(['source_id', 'role_id', 'status_id', 'audit_id']);           // whole numbers, not UUIDs
const MONEY = new Set(['rate_total', 'total', 'total_charges', 'total_paid', 'balance', 'amount', 'unit_price', 'rate_amount', 'rate']);
const DATES = new Set(['check_in', 'check_out', 'date_from', 'date_to', 'specific_date', 'today']);
const STAMPS = new Set(['created_at', 'paid_at', 'charged_at', 'expires_at', 'last_seen_at']);
function walk(v, bad, key = '') {
  if (Array.isArray(v)) return v.forEach(x => walk(x, bad, key));
  if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, bad, k));
  if (v === null || v === undefined) return;
  if (/_id$/.test(key) && !LOOKUP_IDS.has(key) && !isUuid(v)) bad.push(`${key}=${v} is not a UUID`);
  if (LOOKUP_IDS.has(key) && !Number.isInteger(v)) bad.push(`${key}=${v} is not a whole number`);
  if (key === 'reservation_ref' && !/^R-[A-Z0-9]{6}$/.test(v)) bad.push(`reservation_ref=${v}`);
  if (MONEY.has(key) && typeof v === 'number' && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) bad.push(`${key}=${v} has more than 2 decimals`);
  if (DATES.has(key) && typeof v === 'string' && !ISO_DATE.test(v)) bad.push(`${key}=${v} is not YYYY-MM-DD`);
  if (STAMPS.has(key) && typeof v === 'string' && !ISO_TS.test(v)) bad.push(`${key}=${v} is not an ISO timestamp`);
}
const shapeOk = (r) => {
  const e = r.body && r.body.error; if (!e) return false;
  const keys = Object.keys(e).sort().join(',');
  return (keys === 'code,message,request_id' || keys === 'code,fields,message,request_id') && typeof e.message === 'string' && CODES[e.code] && CODES[e.code][0] === r.status
    && e.request_id === r.headers.get('x-request-id') && isUuid(e.request_id);
};

(async () => {
  const server = await boot();
  const t = S.today(), from = S.addDays(t, 20), to = S.addDays(from, 2);
  const typeId = (await api('GET', '/api/room-types', null, 'frontdesk')).body.find(x => x.name === 'Family Suite').room_type_id;
  const book = () => api('POST', '/api/reservations', { guest: { full_name: 'Contract Guest' }, room_type_id: typeId, check_in: from, check_out: to, total_guests: 2, source_id: 1 }, 'frontdesk');

  // ---- every error has the same shape, a catalogued code, the matching status and the request id
  const cases = [
    ['no token',                          () => api('GET', '/api/reservations'),                                                     401, 'UNAUTHENTICATED'],
    ['garbage token',                     () => api('GET', '/api/reservations', null, 'not-a-token'),                                401, 'UNAUTHENTICATED'],
    ['wrong password',                    () => api('POST', '/api/login', { email: DEMO.admin.email, password: 'wrong-password-1' }), 401, 'INVALID_CREDENTIALS'],
    ['unknown email (same answer)',       () => api('POST', '/api/login', { email: 'nobody@fds.test', password: 'wrong-password-1' }), 401, 'INVALID_CREDENTIALS'],
    ['login without fields',              () => api('POST', '/api/login', {}),                                                       400, 'VALIDATION_ERROR'],
    ['invalid JSON',                      () => api('POST', '/api/login', '{not json'),                                              400, 'VALIDATION_ERROR'],
    ['id that is not a UUID',             () => api('GET', '/api/reservations/123', null, 'frontdesk'),                              400, 'VALIDATION_ERROR'],
    ['unknown reservation',               () => api('GET', '/api/reservations/00000000-0000-4000-8000-000000000000', null, 'frontdesk'), 404, 'NOT_FOUND'],
    ['unknown endpoint',                  () => api('GET', '/api/nothing-here', null, 'frontdesk'),                                  404, 'NOT_FOUND'],
    ['role not allowed',                  () => api('POST', '/api/rates', {}, 'frontdesk'),                                          403, 'FORBIDDEN'],
    ['Manager cannot approve',            () => api('POST', '/api/rates/00000000-0000-4000-8000-000000000000/approve', null, 'manager'), 403, 'FORBIDDEN'],
    ['bad reservation fields',            () => api('POST', '/api/reservations', { check_in: 'tomorrow', total_guests: 0 }, 'frontdesk'), 400, 'VALIDATION_ERROR'],
    ['bad payment fields',                () => api('POST', '/api/reservations/00000000-0000-4000-8000-000000000000/payments', { amount: -5 }, 'frontdesk'), 400, 'VALIDATION_ERROR'],
    ['bad rate fields',                   () => api('POST', '/api/rates', { rule_type: 'DATE_RANGE', rate_amount: 'abc' }, 'manager'), 400, 'VALIDATION_ERROR'],
  ];
  for (const [label, fn, status, code] of cases) { const r = await fn(); ok(r.status === status && r.body.error && r.body.error.code === code && shapeOk(r), `${label}: ${status} ${code}, standard shape`); }

  const fe = (await api('POST', '/api/reservations', { check_in: 'tomorrow', total_guests: 0 }, 'frontdesk')).body.error.fields.map(f => f.field).sort();
  ok(['check_in', 'check_out', 'guest.full_name', 'room_type_id', 'total_guests'].every(f => fe.includes(f)), 'field errors name every wrong field: ' + fe.join(', '));
  const lf = (await api('POST', '/api/login', {})).body.error.fields.map(f => f.field).sort().join(',');
  ok(lf === 'email,password', 'login field errors: email, password');

  // ---- business conflicts carry specific codes
  await book(); await book(); const sold = await book();
  ok(sold.status === 409 && sold.body.error.code === 'SOLD_OUT' && shapeOk(sold), 'third booking of a 2-room type: 409 SOLD_OUT');
  const res = (await api('GET', '/api/reservations?q=Contract', null, 'frontdesk')).body[0];
  const co = await api('POST', `/api/reservations/${res.reservation_id}/check-out`, null, 'frontdesk');
  ok(co.status === 409 && co.body.error.code === 'INVALID_STATE' && shapeOk(co), 'check-out of a stay that never checked in: 409 INVALID_STATE');
  const ci = await api('POST', `/api/reservations/${res.reservation_id}/check-in`, null, 'frontdesk');
  const co2 = await api('POST', `/api/reservations/${res.reservation_id}/check-out`, null, 'frontdesk');
  ok(co2.status === 409 && co2.body.error.code === 'BALANCE_OUTSTANDING' && shapeOk(co2), 'check-out with a balance: 409 BALANCE_OUTSTANDING');
  const base2 = await api('POST', '/api/rates', { room_type_id: typeId, rule_type: 'BASE', rate_amount: 330 }, 'manager');
  const ap = await api('POST', `/api/rates/${base2.body.rate_rule_id}/approve`, null, 'admin');
  ok(ap.status === 409 && ap.body.error.code === 'BASE_RATE_EXISTS' && shapeOk(ap), 'second approved Base Rate: 409 BASE_RATE_EXISTS');

  // ---- identifiers and formats across successful responses
  const probes = ['/api/me', '/api/sources', '/api/room-types', '/api/dashboard', `/api/availability?from=${from}&to=${to}&guests=2`, '/api/reservations', `/api/reservations/${res.reservation_id}`,
    `/api/reservations/${res.reservation_id}/free-rooms`, '/api/rooms', '/api/rates'];
  const problems = [];
  for (const p of probes) { const r = await api('GET', p, null, 'admin'); if (r.status !== 200) problems.push(`${p} -> ${r.status}`); walk(r.body, problems); }
  walk((await api('GET', '/api/audit', null, 'admin')).body, problems);
  walk(ci.body, problems); walk((await api('POST', '/api/login', { email: DEMO.admin.email, password: DEMO.admin.password })).body, problems);
  ok(problems.length === 0, 'identifiers are UUIDs (lookup ids are whole numbers), reservation_ref is R-XXXXXX, dates are YYYY-MM-DD, money has at most 2 decimals, timestamps are ISO 8601 UTC' + (problems.length ? ': ' + problems.slice(0, 3).join('; ') : ''));

  // ---- headers
  const h = await api('GET', '/api/me', null, 'admin');
  ok(isUuid(h.headers.get('x-request-id')), 'every response carries an X-Request-Id');
  const pre = await fetch(`http://localhost:${server.address().port}/api/login`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*' && /Authorization/.test(pre.headers.get('access-control-allow-headers')), 'CORS preflight is answered, so a separate front end can call the API');

  // ---- sign-in contract: token, expiry, revocation, lockout (the S056 behaviour the contract describes)
  const lg = await api('POST', '/api/login', { email: DEMO.frontdesk.email, password: DEMO.frontdesk.password });
  ok(lg.status === 200 && typeof lg.body.token === 'string' && lg.body.token.length >= 40 && ISO_TS.test(lg.body.expires_at) && lg.body.user.role === 'FRONT_DESK' && !('password_hash' in lg.body.user), 'login returns token, expires_at and the user (no password data)');
  const tk = lg.body.token;
  ok((await api('GET', '/api/me', null, tk)).status === 200, 'the token works');
  await api('POST', '/api/logout', null, tk);
  const rv = await api('GET', '/api/me', null, tk);
  ok(rv.status === 401 && rv.body.error.code === 'SESSION_REVOKED' && shapeOk(rv), 'after logout the token is refused: 401 SESSION_REVOKED');
  const db = await require('../db').connect();
  const tk2 = (await api('POST', '/api/login', { email: DEMO.frontdesk.email, password: DEMO.frontdesk.password })).body.token;
  await db.q("update user_sessions set expires_at = now() - interval '1 minute' where token_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [tk2]);
  const ex = await api('GET', '/api/me', null, tk2);
  ok(ex.status === 401 && ex.body.error.code === 'SESSION_EXPIRED' && shapeOk(ex), 'a session past its lifetime: 401 SESSION_EXPIRED');
  const tk3 = (await api('POST', '/api/login', { email: DEMO.frontdesk.email, password: DEMO.frontdesk.password })).body.token;
  await db.q("update user_sessions set last_seen_at = now() - interval '2 hours' where token_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [tk3]);
  ok((await api('GET', '/api/me', null, tk3)).body.error.code === 'SESSION_EXPIRED', 'an idle session (no activity for over an hour): 401 SESSION_EXPIRED');
  const [{ property_id }] = await db.q('select property_id from properties limit 1');
  await db.q("insert into users(property_id,role_id,full_name,email,password_hash) values($1,3,'Lock Test','lock.test@fds.test',$2)", [property_id, await hashPassword('Sunrise-Lock-2026')]);
  for (let i = 0; i < 5; i++) await api('POST', '/api/login', { email: 'lock.test@fds.test', password: 'wrong-password-1' });
  const lk = await api('POST', '/api/login', { email: 'lock.test@fds.test', password: 'Sunrise-Lock-2026' });
  ok(lk.status === 429 && lk.body.error.code === 'ACCOUNT_LOCKED' && shapeOk(lk), '5 wrong passwords lock the account: even the right password gets 429 ACCOUNT_LOCKED');
  await db.q("update users set is_active=false where email=$1", [DEMO.manager.email]);
  const dis = await api('POST', '/api/login', { email: DEMO.manager.email, password: DEMO.manager.password });
  ok(dis.status === 403 && dis.body.error.code === 'ACCOUNT_DISABLED' && shapeOk(dis), 'a deactivated account: 403 ACCOUNT_DISABLED');
  await db.q("update users set is_active=true where email=$1", [DEMO.manager.email]);
  summary();
})().catch(e => { console.error(e); process.exit(1); });
