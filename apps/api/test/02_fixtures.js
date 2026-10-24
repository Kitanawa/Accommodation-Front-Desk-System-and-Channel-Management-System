// S054: the seed fixtures are complete, repeatable and anonymous.
const { ok, summary } = require('./helpers');
const { createEmbedded } = require('../db');
const M = require('../migrate');
const { seed, DEMO, SECOND } = require('../seed');
const { verifyPassword, validatePassword } = require('../password');
const S = require('../service');
const n = async (d, sql, p) => (await d.q(sql, p))[0].n;

(async () => {
  const d = await createEmbedded('memory'); await M.up(d); await seed(d);
  const counts = async () => JSON.stringify([await n(d, 'select count(*)::int n from properties'), await n(d, 'select count(*)::int n from users'), await n(d, 'select count(*)::int n from room_types'),
    await n(d, 'select count(*)::int n from rooms'), await n(d, 'select count(*)::int n from room_stock'), await n(d, 'select count(*)::int n from rate_rules'),
    await n(d, 'select count(*)::int n from reservations'), await n(d, 'select count(*)::int n from charges')]);
  const expected = '[1,3,3,12,369,6,3,8]';
  ok(await counts() === expected, `fixture counts: 1 property, 3 users, 3 room types, 12 rooms, 369 stock rows, 6 rates, 3 reservations, 8 room charges`);
  ok(await n(d, "select count(*)::int n from rate_rules where approval_status='APPROVED'") === 5 && await n(d, "select count(*)::int n from rate_rules where approval_status='PENDING'") === 1, 'rates: 5 approved, 1 pending (to demonstrate approval)');
  ok(await n(d, 'select coalesce(sum(reserved_rooms),0)::int n from room_stock') === 8, 'stock matches the sample reservations (8 reserved room-nights)');
  const t = S.today();
  ok(await n(d, 'select count(*)::int n from room_stock where stock_date=$1::date', [S.addDays(t, -2)]) === 3 && await n(d, 'select count(*)::int n from room_stock where stock_date=$1::date', [S.addDays(t, 120)]) === 3, 'stock covers from 2 days ago to 120 days ahead');
  ok(await n(d, "select count(*)::int n from users u join roles r using(role_id) where r.name in ('ADMINISTRATOR','OWNER_MANAGER','FRONT_DESK')") === 3, 'one user for each of the three roles');
  ok(await n(d, "select count(*)::int n from users where can_approve_rates") === 1, 'only the Administrator can approve rates at first (Manager approval is off)');

  // anonymity
  const emails = (await d.q('select email from users union all select email from guests')).map(r => r.email);
  ok(emails.every(e => /@(fds|example)\.test$/.test(e)), 'every email ends in @fds.test or @example.test (reserved test domains)');
  ok((await d.q('select phone from guests')).every(r => r.phone === '+60 12-000 0000'), 'every phone number is the fake +60 12-000 0000');
  ok((await d.q('select id_passport_no x from guests')).every(r => /^X000000\d$/.test(r.x)), 'every ID / passport number is a fake X000000n');
  ok((await d.q('select full_name from guests')).every(r => /^Guest (One|Two|Three)$/.test(r.full_name)), 'guests are named Guest One / Two / Three');
  ok((await d.q('select name from properties'))[0].name.includes('(demo)'), 'the property is labelled as a demo');
  const hashes = (await d.q('select password_hash h from users')).map(r => r.h);
  ok(hashes.every(h => /^scrypt\$32768\$8\$1\$/.test(h)) && !hashes.some(h => Object.values(DEMO).some(u => h.includes(u.password))), 'passwords are stored as scrypt hashes, never as text');
  let allVerify = true, allPolicy = true;
  for (const u of Object.values(DEMO)) {
    const [row] = await d.q('select password_hash h from users where email=$1', [u.email]);
    allVerify = allVerify && await verifyPassword(u.password, row.h) && !(await verifyPassword(u.password + 'x', row.h));
    allPolicy = allPolicy && validatePassword(u.password, { email: u.email, full_name: u.name }).length === 0;
  }
  ok(allVerify, 'each demo password verifies against its stored hash, and a wrong one does not');
  ok(allPolicy, 'each demo password meets the password rules');

  // repeatable
  await M.down(d, { steps: Infinity }); await M.up(d); await seed(d);
  ok(await counts() === expected, 'reset (down all, up, seed) gives the same fixtures again');
  const d2 = await createEmbedded('memory'); await M.up(d2); const r2 = await seed(d2, { secondProperty: true });
  ok(await n(d2, 'select count(*)::int n from properties') === 2 && await n(d2, 'select count(*)::int n from users') === 4 && await n(d2, 'select count(*)::int n from rooms') === 14, 'the optional second property adds 1 property, 1 user and 2 rooms');
  ok(await n(d2, "select count(*)::int n from users where email=$1 and property_id<>$2", [SECOND.email, r2.property_id]) === 1, 'the second property user belongs to the other property');

  // startup loads fixtures once only (ensureSchema)
  const db = require('../db'); const x = await db.ensureSchema(); await db.ensureSchema();
  ok(await n(x, 'select count(*)::int n from users') === 3 && await n(x, 'select count(*)::int n from reservations') === 3, 'starting the server twice loads fixtures only once');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
