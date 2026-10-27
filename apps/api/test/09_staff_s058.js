// S058: staff account creation, password validation, and the account lifecycle.
const { ok, summary, boot, api, tok, DEMO } = require('./helpers');
const { validatePassword, POLICY } = require('../password');
const A = require('../auth');
const login = (email, password) => api('POST', '/api/login', { email, password });
const fields = r => (r.body.error && r.body.error.fields || []).map(f => f.field);
const msgs = (r, f) => (r.body.error.fields || []).filter(x => x.field === f).map(x => x.message).join(' | ');

(async () => {
  await boot(); const db = await require('../db').connect();

  // ---- password rules (unit)
  const v = (pw, who) => validatePassword(pw, who).length;
  ok(v('Short1a') === 1 && /at least 10/.test(validatePassword('Short1a')[0]), 'too short is rejected with a clear message');
  ok(v('abcdefghijklm') >= 1 && /number/.test(validatePassword('abcdefghijklm').join()), 'no number is rejected');
  ok(v('1234567890123') >= 1 && /letter/.test(validatePassword('1234567890123').join()), 'no letter is rejected');
  ok(v('x'.repeat(129) + '1') >= 1, 'longer than 128 characters is rejected');
  ok(v('Password123') >= 1 && v('Qwerty12345') >= 1 && v('Welcome2026') >= 1 && v('Administrator1') >= 1, 'very common passwords with numbers added are rejected');
  ok(v('aaaaaaaaaaaa') >= 1, 'one repeated character is rejected');
  ok(v('Maple-River-2026', { email: 'jane.smith@fds.test', full_name: 'Jane Smith' }) === 0, 'a good passphrase is accepted');
  ok(v('xx-jane.smith-99', { email: 'jane.smith@fds.test' }) >= 1, 'a password containing the email name is rejected');
  ok(v('xx-smithy-99', { full_name: 'Jane Smith' }) >= 1 && v('xx-Jane-9999', { full_name: 'Jane Smith' }) >= 1, 'a password containing a name part of 4+ letters is rejected');
  ok(v('Zed-Maple-River-9', { full_name: 'Al Bo Zed' }) === 0, 'short name parts (under 4 letters) do not block a password');
  ok(v(undefined) === 1 && v(12345678901) === 1 && v(null) === 1, 'a missing or non-text password is rejected, not crashing');
  ok(v('Pass wörd-Ünï-2026') === 0, 'spaces and non-English characters are allowed');
  ok(POLICY.min_length === 10 && POLICY.rules.length === 4, 'the policy object matches what the rules say');
  const pol = await api('GET', '/api/password-policy');
  ok(pol.status === 200 && pol.body.min_length === 10 && pol.body.max_length === 128 && pol.body.rules.length === 4, 'GET /api/password-policy is public and shows the rules');

  // ---- creating accounts
  const good = { full_name: 'Lena Park', email: 'Lena.Park@FDS.test', role: 'FRONT_DESK', password: 'Maple-River-2026' };
  const c1 = await api('POST', '/api/users', good, 'admin');
  ok(c1.status === 201 && c1.body.email === 'lena.park@fds.test' && c1.body.role === 'FRONT_DESK' && c1.body.is_active === true && c1.body.can_approve_rates === false, 'Administrator creates a Front Desk account (email stored in lower case, active, no rate approval)');
  ok(!JSON.stringify(c1.body).match(/hash|password/i), 'the response shows no password data');
  const [row] = await db.q('select password_hash from users where email=$1', ['lena.park@fds.test']);
  ok(/^scrypt\$/.test(row.password_hash) && !row.password_hash.includes('Maple'), 'the password is stored as a scrypt hash');
  const lt = await login('lena.park@fds.test', good.password);
  ok(lt.status === 200 && lt.body.user.role === 'FRONT_DESK' && lt.body.user.name === 'Lena Park', 'the new person can sign in at once with that password');
  ok((await login('LENA.PARK@fds.test', good.password)).status === 200, 'and the email works in any letter case');
  ok((await api('GET', '/api/users', null, 'admin')).body.some(u => u.email === 'lena.park@fds.test'), 'she appears in the staff list');

  // validation: every problem at once, with field names
  const none = await api('POST', '/api/users', {}, 'admin');
  ok(none.status === 400 && ['role', 'full_name', 'email', 'password'].every(f => fields(none).includes(f)), 'empty body: 400 listing role, full_name, email and password');
  const multi = await api('POST', '/api/users', { full_name: 'A', email: 'not-an-email', role: 'FRONT_DESK', password: 'short' }, 'admin');
  ok(multi.status === 400 && fields(multi).includes('full_name') && fields(multi).includes('email') && fields(multi).filter(f => f === 'password').length >= 2, 'several wrong fields: all reported together (password can list several problems)');
  ok(/at least 10/.test(msgs(multi, 'password')) && /number/.test(msgs(multi, 'password')), 'password problems are named: too short AND no number');
  const bad1 = await api('POST', '/api/users', { ...good, email: 'nina.x@fds.test', role: 'SUPERUSER' }, 'admin');
  ok(bad1.status === 400 && fields(bad1).includes('role') && /ADMINISTRATOR/.test(msgs(bad1, 'role')), 'unknown role: 400 naming the allowed roles');
  ok((await api('POST', '/api/users', { ...good, email: 'x@y' }, 'admin')).status === 400, 'an email without a proper domain is rejected');
  ok((await api('POST', '/api/users', { ...good, email: 'a b@fds.test' }, 'admin')).status === 400, 'an email with a space is rejected');
  ok((await api('POST', '/api/users', { ...good, email: 'x'.repeat(170) + '@fds.test' }, 'admin')).status === 400, 'an email over 160 characters is rejected');
  ok((await api('POST', '/api/users', { ...good, email: 'tom.x@fds.test', full_name: 'x'.repeat(121) }, 'admin')).status === 400, 'a name over 120 characters is rejected');
  const own = await api('POST', '/api/users', { full_name: 'Ravi Kumar', email: 'ravi@fds.test', role: 'FRONT_DESK', password: 'Ravi-Pass-2026-x' }, 'admin');
  ok(own.status === 400 && /name or email/.test(msgs(own, 'password')), 'a password built from the person\'s own name is rejected');
  const dup = await api('POST', '/api/users', { ...good, email: 'LENA.PARK@fds.test' }, 'admin');
  ok(dup.status === 409 && dup.body.error.code === 'CONFLICT' && fields(dup).includes('email'), 'the same email in other letter case: 409 CONFLICT on field email');
  ok((await api('POST', '/api/users', { ...good, email: 'ben.t@fds.test', can_approve_rates: 'yes' }, 'admin')).status === 400, 'can_approve_rates must be true or false');
  ok((await api('POST', '/api/users', { ...good, email: 'ben.t@fds.test', can_approve_rates: true }, 'admin')).status === 400, 'can_approve_rates is only for Owner/Manager accounts');
  ok((await api('POST', '/api/users', 'not json', 'admin')).status === 400, 'invalid JSON: 400');
  const count0 = (await db.q('select count(*)::int n from users'))[0].n;
  await api('POST', '/api/users', { ...good, email: 'zzz@fds.test', password: 'short' }, 'admin');
  ok((await db.q('select count(*)::int n from users'))[0].n === count0, 'a rejected request creates nothing');

  // roles
  const mgr = await api('POST', '/api/users', { full_name: 'Omar Lee', email: 'omar.l@fds.test', role: 'OWNER_MANAGER', password: 'Cedar-Light-2026', can_approve_rates: true }, 'admin');
  ok(mgr.status === 201 && mgr.body.role === 'OWNER_MANAGER' && mgr.body.can_approve_rates === true, 'Administrator creates a Manager with rate approval');
  const adm = await api('POST', '/api/users', { full_name: 'Sara Wu', email: 'sara.w@fds.test', role: 'ADMINISTRATOR', password: 'Harbor-Wind-2026' }, 'admin');
  ok(adm.status === 201 && adm.body.role === 'ADMINISTRATOR', 'Administrator creates another Administrator');
  const mfd = await api('POST', '/api/users', { full_name: 'Kai Ong', email: 'kai.o@fds.test', role: 'FRONT_DESK', password: 'River-Stone-2026' }, 'manager');
  ok(mfd.status === 201 && mfd.body.role === 'FRONT_DESK', 'Manager creates a Front Desk account');
  for (const role of ['OWNER_MANAGER', 'ADMINISTRATOR']) {
    const r = await api('POST', '/api/users', { full_name: 'Nope Nope', email: `n.${role}@fds.test`, role, password: 'River-Stone-2026' }, 'manager');
    ok(r.status === 403 && r.body.error.code === 'FORBIDDEN', `Manager cannot create a ${role} account: 403`);
  }
  ok((await api('POST', '/api/users', { full_name: 'Tia Fox', email: 'tia.f@fds.test', role: 'FRONT_DESK', password: 'River-Stone-2026', can_approve_rates: true }, 'manager')).status === 403, 'Manager cannot grant rate approval: 403');
  ok((await api('POST', '/api/users', good, 'frontdesk')).status === 403 && (await api('GET', '/api/users', null, 'frontdesk')).status === 403, 'Front Desk can neither create nor list accounts: 403');
  ok((await api('GET', '/api/roles', null, 'manager')).body.map(r => r.name).join() === 'ADMINISTRATOR,OWNER_MANAGER,FRONT_DESK', 'GET /api/roles lists the three roles');
  const newMgrToken = (await login('omar.l@fds.test', 'Cedar-Light-2026')).body.token;
  const rate = (await api('GET', '/api/rates', null, 'admin')).body.find(r => r.approval_status === 'PENDING');
  ok((await api('POST', `/api/rates/${rate.rate_rule_id}/approve`, null, newMgrToken)).status === 200, 'the new Manager can approve rates, as the Administrator allowed');

  // ---- editing
  const lena = c1.body.user_id, lenaTok = lt.body.token;
  const rn = await api('PATCH', `/api/users/${lena}`, { full_name: 'Lena Q Park' }, 'admin');
  ok(rn.status === 200 && rn.body.full_name === 'Lena Q Park' && (await api('GET', '/api/me', null, lenaTok)).status === 200, 'renaming works and does not end her session');
  ok((await api('PATCH', `/api/users/${lena}`, {}, 'admin')).status === 200, 'an empty edit changes nothing and succeeds');
  ok((await api('PATCH', `/api/users/${lena}`, { is_active: 'no' }, 'admin')).status === 400 && (await api('PATCH', `/api/users/${lena}`, { role: 'KING' }, 'admin')).status === 400 && (await api('PATCH', `/api/users/${lena}`, { full_name: 'x' }, 'admin')).status === 400, 'bad values in an edit: 400');
  ok((await api('PATCH', `/api/users/${lena}`, { role: 'OWNER_MANAGER' }, 'manager')).status === 403 && (await api('PATCH', `/api/users/${lena}`, { can_approve_rates: true }, 'manager')).status === 403, 'Manager cannot change a role or rate approval (403)');
  const off = await api('PATCH', `/api/users/${lena}`, { is_active: false }, 'manager');
  ok(off.status === 200 && off.body.is_active === false, 'Manager can deactivate a Front Desk account');
  const dead = await api('GET', '/api/me', null, lenaTok);
  ok(dead.status === 401 && dead.body.error.code === 'SESSION_REVOKED', 'her open session ends at once');
  const refused = await login('lena.park@fds.test', good.password);
  ok(refused.status === 403 && refused.body.error.code === 'ACCOUNT_DISABLED', 'she cannot sign in while deactivated: 403 ACCOUNT_DISABLED');
  ok((await login('lena.park@fds.test', 'Wrong-Password-1')).body.error.code === 'INVALID_CREDENTIALS', 'but a wrong password still says only "wrong email or password" (no hint the account is disabled)');
  ok((await api('PATCH', `/api/users/${lena}`, { is_active: true }, 'manager')).status === 200 && (await login('lena.park@fds.test', good.password)).status === 200, 'reactivating lets her sign in again');
  const promote = await api('PATCH', `/api/users/${lena}`, { role: 'OWNER_MANAGER', can_approve_rates: true }, 'admin');
  ok(promote.status === 200 && promote.body.role === 'OWNER_MANAGER' && promote.body.can_approve_rates === true, 'Administrator promotes Front Desk to Manager with rate approval');
  const demote = await api('PATCH', `/api/users/${lena}`, { role: 'FRONT_DESK' }, 'admin');
  ok(demote.status === 200 && demote.body.role === 'FRONT_DESK' && demote.body.can_approve_rates === false, 'demoting from Manager also removes rate approval');
  ok((await api('PATCH', `/api/users/${lena}`, { can_approve_rates: true }, 'admin')).status === 400, 'rate approval cannot be given to a Front Desk account');
  // protections
  const adminId = (await api('GET', '/api/me', null, 'admin')).body.user_id;
  ok((await api('PATCH', `/api/users/${adminId}`, { is_active: false }, 'admin')).status === 409, 'an Administrator cannot deactivate their own account (409)');
  ok((await api('PATCH', `/api/users/${adminId}`, { role: 'FRONT_DESK' }, 'admin')).status === 409, 'or change their own role (409)');
  const sara = adm.body.user_id;
  ok((await api('PATCH', `/api/users/${sara}`, { is_active: false }, 'admin')).status === 200, 'with two Administrators, one may deactivate the other');
  await db.q("update users set is_active=true where email='sara.w@fds.test'");
  await db.q("update users set role_id=2 where user_id=$1", [sara]);          // only the original admin is left
  ok((await db.q("select count(*)::int n from users u join roles r using(role_id) where r.name='ADMINISTRATOR' and u.is_active"))[0].n === 1, '(set up: exactly one active Administrator remains)');
  await db.q("update users set role_id=1 where user_id=$1", [sara]);

  // ---- password reset and change
  const target = (await api('POST', '/api/users', { full_name: 'Mia Tan', email: 'mia.t@fds.test', role: 'FRONT_DESK', password: 'Violet-Moon-2026' }, 'admin')).body.user_id;
  const miaTok = (await login('mia.t@fds.test', 'Violet-Moon-2026')).body.token;
  for (let i = 0; i < 5; i++) await login('mia.t@fds.test', 'Wrong-Password-1');
  ok((await login('mia.t@fds.test', 'Violet-Moon-2026')).status === 429, '(set up: Mia is locked out)');
  ok((await api('POST', `/api/users/${target}/reset-password`, { new_password: 'short' }, 'manager')).status === 400, 'reset with a weak password: 400, nothing changes');
  ok((await api('POST', `/api/users/${target}/reset-password`, { new_password: 'Amber-Field-2026' }, 'frontdesk')).status === 403, 'Front Desk cannot reset passwords');
  const rs = await api('POST', `/api/users/${target}/reset-password`, { new_password: 'Amber-Field-2026' }, 'manager');
  ok(rs.status === 200, 'Manager resets a Front Desk password');
  ok((await api('GET', '/api/me', null, miaTok)).body.error.code === 'SESSION_REVOKED', 'her old session ended');
  ok((await login('mia.t@fds.test', 'Violet-Moon-2026')).status === 401 && (await login('mia.t@fds.test', 'Amber-Field-2026')).status === 200, 'the old password fails, the new one works, and the lockout is cleared');
  ok((await api('POST', `/api/users/${sara}/reset-password`, { new_password: 'Amber-Field-2026' }, 'manager')).status === 403, 'Manager cannot reset an Administrator\'s password');
  const rv = await api('POST', `/api/users/${target}/revoke-sessions`, null, 'manager');
  ok(rv.status === 200 && typeof rv.body.revoked === 'number', 'POST /api/users/:id/revoke-sessions reports how many ended');

  // change my own password
  const me1 = (await login('mia.t@fds.test', 'Amber-Field-2026')).body.token, me2 = (await login('mia.t@fds.test', 'Amber-Field-2026')).body.token;
  const body = (cur, nw) => ({ current_password: cur, new_password: nw });
  const noFields = await api('POST', '/api/me/password', {}, me1);
  ok(noFields.status === 400 && fields(noFields).includes('current_password') && fields(noFields).includes('new_password'), 'change password with no fields: 400 naming both');
  const wc = await api('POST', '/api/me/password', body('Not-My-Password-1', 'Fresh-Garden-2026'), me1);
  ok(wc.status === 400 && fields(wc).join() === 'current_password' && wc.body.error.code === 'VALIDATION_ERROR', 'wrong current password: 400 on field current_password (not 401, so the screen does not sign her out)');
  ok((await api('GET', '/api/me', null, me1)).status === 200, 'and her session stays valid');
  const weakNew = await api('POST', '/api/me/password', body('Amber-Field-2026', 'tiny'), me1);
  ok(weakNew.status === 400 && fields(weakNew).includes('new_password'), 'weak new password: 400 on field new_password');
  ok((await api('POST', '/api/me/password', body('Amber-Field-2026', 'Amber-Field-2026'), me1)).status === 400, 'new password equal to the current one: 400');
  ok((await api('POST', '/api/me/password', body('Amber-Field-2026', 'Fresh-mia.t-Garden-26'), me1)).status === 400, 'new password containing her own email name: 400');
  const okc = await api('POST', '/api/me/password', body('Amber-Field-2026', 'Fresh-Garden-2026'), me1);
  ok(okc.status === 200, 'correct current + good new password: 200');
  ok((await api('GET', '/api/me', null, me1)).status === 200, 'the session she used stays signed in');
  ok((await api('GET', '/api/me', null, me2)).body.error.code === 'SESSION_REVOKED', 'her other session is ended');
  ok((await login('mia.t@fds.test', 'Amber-Field-2026')).status === 401 && (await login('mia.t@fds.test', 'Fresh-Garden-2026')).status === 200, 'old password stops working, new one works');
  const guess = (await login('mia.t@fds.test', 'Fresh-Garden-2026')).body.token;
  for (let i = 0; i < 5; i++) await api('POST', '/api/me/password', body('Guess-Guess-123', 'Another-Garden-2026'), guess);
  ok((await login('mia.t@fds.test', 'Fresh-Garden-2026')).status === 429, 'guessing the current password through this endpoint also triggers the lockout');

  // ---- audit
  const acts = (await api('GET', '/api/audit', null, 'admin')).body.map(a => a.action);
  ok(['USER_CREATED', 'USER_UPDATED', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'SESSIONS_REVOKED', 'ACCOUNT_LOCKED', 'SESSION_CREATED'].every(a => acts.includes(a)), 'the audit log records account creation, edits, resets, password changes, revocations, lockouts and sign-ins');
  const all = JSON.stringify(await db.q('select old_values, new_values from audit_records'));
  ok(!/Violet|Amber|Fresh-Garden|Maple-River|hash/i.test(all), 'no password or hash ever appears in the audit log');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
