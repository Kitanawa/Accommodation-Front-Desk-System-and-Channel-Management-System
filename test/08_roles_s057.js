// S057: server-side role and property checks. Every endpoint is called by every role and the answer is compared with the SRS matrix.
const { ok, summary, boot, api, tok, DEMO } = require('./helpers');
const { endpoints } = require('../docs/contract');
const P = require('../permissions');
const { hashPassword } = require('../password');
const NIL = '00000000-0000-4000-8000-000000000000';
const path = e => e.p.replace('{id}', NIL);
const ROLE = { admin: 'ADMINISTRATOR', manager: 'OWNER_MANAGER', frontdesk: 'FRONT_DESK' };

(async () => {
  await boot(); const db = await require('../db').connect();
  const gated = endpoints.filter(e => e.perm), open = endpoints.filter(e => !e.perm);

  // 1) no token: every protected endpoint says 401, never data and never 403
  let bad = [];
  for (const e of endpoints.filter(e => e.who !== 'public')) { const r = await api(e.m, path(e), e.body ? {} : undefined); if (r.status !== 401 || r.body.error.code !== 'UNAUTHENTICATED') bad.push(`${e.m} ${e.p} -> ${r.status}`); }
  ok(bad.length === 0, `all ${endpoints.filter(e => e.who !== 'public').length} protected endpoints refuse a request with no token (401)` + (bad.length ? ': ' + bad.join('; ') : ''));
  bad = [];
  for (const e of endpoints.filter(e => e.who !== 'public')) { const r = await api(e.m, path(e), e.body ? {} : undefined, 'not-a-real-token'); if (r.status !== 401) bad.push(`${e.m} ${e.p} -> ${r.status}`); }
  ok(bad.length === 0, 'and refuse a made-up token (401)' + (bad.length ? ': ' + bad.join('; ') : ''));

  // 2) the whole matrix: for each permission-gated endpoint and each role, 403 exactly when the role lacks the permission
  const users = { admin: { role: 'ADMINISTRATOR' }, manager: { role: 'OWNER_MANAGER', can_approve_rates: false }, frontdesk: { role: 'FRONT_DESK' } };
  let cells = 0; bad = [];
  for (const e of gated) for (const who of Object.keys(users)) {
    const allowed = P.can(users[who], e.perm) || (e.perm === 'users.manage_frontdesk' && who !== 'frontdesk');
    const r = await api(e.m, path(e), e.body ? {} : undefined, who); cells++;
    const got403 = r.status === 403 && r.body.error.code === 'FORBIDDEN';
    if (allowed === got403) bad.push(`${who} ${e.m} ${e.p}: expected ${allowed ? 'allowed' : '403'}, got ${r.status}`);
  }
  ok(bad.length === 0, `role matrix: ${gated.length} gated endpoints x 3 roles = ${cells} calls, each allowed or 403 exactly as the SRS matrix says` + (bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''));

  // 3) "Configurable" approval
  const rate = (await api('GET', '/api/rates', null, 'admin')).body.find(r => r.approval_status === 'PENDING');
  const typeId = (await api('GET', '/api/room-types', null, 'admin')).body.find(t => t.name === 'Family Suite').room_type_id;
  const mk = async () => (await api('POST', '/api/rates', { room_type_id: typeId, rule_type: 'DATE_RANGE', rate_amount: 400, date_from: '2027-03-01', date_to: '2027-03-05' }, 'manager')).body.rate_rule_id;
  const r1 = await mk();
  ok((await api('POST', `/api/rates/${r1}/approve`, null, 'manager')).status === 403, 'Manager with can_approve_rates=false cannot approve');
  await db.q('update users set can_approve_rates=true where email=$1', [DEMO.manager.email]);
  ok((await api('POST', `/api/rates/${r1}/approve`, null, 'manager')).status === 200, 'the same Manager with can_approve_rates=true can approve (applies at once, no new sign-in)');
  const r2 = await mk(); await db.q('update users set can_approve_rates=false where email=$1', [DEMO.manager.email]);
  ok((await api('POST', `/api/rates/${r2}/approve`, null, 'manager')).status === 403, 'switching it off applies at once too');
  ok((await api('POST', `/api/rates/${r2}/approve`, null, 'frontdesk')).status === 403, 'Front Desk can never approve');

  // 4) a Front Desk sees less data in shared endpoints
  ok((await api('GET', '/api/rates', null, 'frontdesk')).body.every(r => r.approval_status === 'APPROVED'), 'Front Desk sees approved rates only');
  ok((await api('GET', '/api/rates', null, 'manager')).body.some(r => r.approval_status === 'PENDING'), 'Manager sees pending rates too');
  ok((await api('GET', '/api/dashboard', null, 'frontdesk')).body.pending_rates === null && typeof (await api('GET', '/api/dashboard', null, 'manager')).body.pending_rates === 'number', 'the dashboard hides the pending-rate count from Front Desk');

  // 5) the role in a request is ignored: a client cannot promote itself
  const sneaky = await api('POST', '/api/rates', { room_type_id: typeId, rule_type: 'BASE', rate_amount: 1, role: 'ADMINISTRATOR' }, 'frontdesk', { 'X-Role': 'ADMINISTRATOR' });
  ok(sneaky.status === 403, 'sending a role in the body or a header does not change what the server allows');
  const jwtLike = 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoiQURNSU5JU1RSQVRPUiJ9.';
  ok((await api('GET', '/api/audit', null, jwtLike)).status === 401, 'a forged token that claims a role is refused');

  // 6) another property: staff-management endpoints respect it too
  const [{ property_id }] = await db.q("insert into properties(name,currency_code) values('Other Hotel (demo)','MYR') returning property_id");
  const [other] = await db.q("insert into users(property_id,role_id,full_name,email,password_hash) values($1,3,'Other Person','other.person@fds.test',$2) returning user_id", [property_id, await hashPassword('Quartz-Other-2026')]);
  ok(!(await api('GET', '/api/users', null, 'admin')).body.some(u => u.email === 'other.person@fds.test'), 'the staff list holds only my property\'s people');
  for (const [label, r] of [['edit', await api('PATCH', `/api/users/${other.user_id}`, { full_name: 'Hacked Name' }, 'admin')],
    ['reset password of', await api('POST', `/api/users/${other.user_id}/reset-password`, { new_password: 'Brand-New-Pass-77' }, 'admin')],
    ['revoke sessions of', await api('POST', `/api/users/${other.user_id}/revoke-sessions`, null, 'admin')]])
    ok(r.status === 404 && r.body.error.code === 'NOT_FOUND', `an Administrator of another property tries to ${label} this user: 404`);
  ok((await db.q('select full_name from users where user_id=$1', [other.user_id]))[0].full_name === 'Other Person', 'and nothing changed');

  // 7) Manager scope inside user management
  const users2 = (await api('GET', '/api/users', null, 'admin')).body, adminU = users2.find(u => u.role === 'ADMINISTRATOR'), fdU = users2.find(u => u.role === 'FRONT_DESK' && u.email === DEMO.frontdesk.email), mgrU = users2.find(u => u.role === 'OWNER_MANAGER');
  ok((await api('PATCH', `/api/users/${adminU.user_id}`, { full_name: 'Changed Admin' }, 'manager')).status === 403, 'Manager cannot edit an Administrator');
  ok((await api('PATCH', `/api/users/${mgrU.user_id}`, { full_name: 'Changed Mgr' }, 'manager')).status === 403, 'Manager cannot edit a Manager (not even themself)');
  ok((await api('PATCH', `/api/users/${fdU.user_id}`, { full_name: 'Front Desk Renamed' }, 'manager')).status === 200, 'Manager can edit a Front Desk account');
  ok((await api('PATCH', `/api/users/${fdU.user_id}`, { full_name: 'Front Desk Staff' }, 'admin')).status === 200, 'Administrator can edit anyone');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
