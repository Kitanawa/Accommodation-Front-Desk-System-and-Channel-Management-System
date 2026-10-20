// S054: migrations go up and down cleanly, are repeatable, are atomic, and the migrated schema enforces the rules.
const fs = require('fs'), os = require('os'), path = require('path');
const { ok, summary } = require('./helpers');
const { createEmbedded } = require('../db');
const M = require('../migrate');
const count = async d => (await d.q("select count(*)::int n from information_schema.tables where table_schema='public' and table_name<>'schema_migrations'"))[0].n;
const hasCol = async (d, t, c) => (await d.q('select 1 x from information_schema.columns where table_name=$1 and column_name=$2', [t, c])).length > 0;
const hasTable = async (d, t) => (await d.q("select 1 x from information_schema.tables where table_schema='public' and table_name=$1", [t])).length > 0;
const rejects = async (d, sql) => { try { await d.exec(sql); return false; } catch { return true; } };
const accepts = async (d, sql) => { try { await d.exec(sql); return true; } catch (e) { console.log('   ', e.message); return false; } };

(async () => {
  const d = await createEmbedded('memory');
  ok(JSON.stringify(M.versions()) === '["001_init","002_auth"]', 'two migrations, in order: 001_init, 002_auth');
  ok((await M.status(d)).every(s => !s.applied), 'a new database has nothing applied');
  ok(JSON.stringify(await M.up(d)) === '["001_init","002_auth"]', 'up applies both migrations');
  ok((await M.status(d)).every(s => s.applied), 'status shows both applied');
  ok(await count(d) === 18, '18 tables exist (17 SRS entities + user_sessions)');
  const ref = async () => JSON.stringify([(await d.q('select count(*)::int n from roles'))[0].n, (await d.q('select count(*)::int n from room_statuses'))[0].n, (await d.q('select count(*)::int n from booking_sources'))[0].n]);
  ok(await ref() === '[3,4,6]', 'reference data loaded: 3 roles, 4 room statuses, 6 booking sources');
  ok((await M.up(d)).length === 0, 'running up again changes nothing');

  ok(JSON.stringify(await M.down(d)) === '["002_auth"]', 'down rolls back only the newest migration');
  ok(!(await hasTable(d, 'user_sessions')) && !(await hasCol(d, 'users', 'is_active')) && await hasTable(d, 'users'), 'user_sessions and the new users columns are gone, users table stays');
  ok((await d.q('select version from schema_migrations')).length === 1, 'schema_migrations records only 001_init');
  await M.up(d);
  ok(await count(d) === 18 && await hasCol(d, 'users', 'locked_until'), 'up after down restores everything');
  await M.down(d, { steps: Infinity });
  ok(await count(d) === 0, 'down all removes every table');
  await M.up(d);
  ok(await count(d) === 18 && await ref() === '[3,4,6]', 'up after down all rebuilds the schema and reference data');

  // atomic: a failing migration leaves no half-done work behind
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(tmp, '001_ok.up.sql'), 'create table t1(id int);'); fs.writeFileSync(path.join(tmp, '001_ok.down.sql'), 'drop table t1;');
  fs.writeFileSync(path.join(tmp, '002_bad.up.sql'), 'create table t2(id int); select * from does_not_exist;'); fs.writeFileSync(path.join(tmp, '002_bad.down.sql'), 'drop table t2;');
  const d2 = await createEmbedded('memory'); let threw = false;
  try { await M.up(d2, { dir: tmp }); } catch { threw = true; }
  ok(threw && await hasTable(d2, 't1') && !(await hasTable(d2, 't2')), 'a failing migration rolls back its own changes (t2 not created, t1 kept)');
  ok(JSON.stringify((await d2.q('select version from schema_migrations')).map(r => r.version)) === '["001_ok"]', 'only the successful migration is recorded');

  // the migrated schema enforces the rules designed in S052/S053
  const sid = (await d.q("insert into properties(name,currency_code) values('P','MYR') returning property_id"))[0].property_id;
  const cat = (await d.q("insert into room_categories(property_id,name) values($1,'C') returning category_id", [sid]))[0].category_id;
  const rt = (await d.q("insert into room_types(category_id,name,max_guests) values($1,'T',2) returning room_type_id", [cat]))[0].room_type_id;
  const gid = (await d.q("insert into guests(full_name) values('G') returning guest_id"))[0].guest_id;
  ok(await accepts(d, `insert into room_stock(room_type_id,stock_date,total_rooms,reserved_rooms) values('${rt}','2026-11-01',5,2)`), 'stock row accepted');
  ok(await rejects(d, `insert into room_stock(room_type_id,stock_date,total_rooms,reserved_rooms) values('${rt}','2026-11-02',5,6)`), 'reserved more than total is rejected');
  ok(await rejects(d, `insert into room_stock(room_type_id,stock_date,total_rooms) values('${rt}','2026-11-01',5)`), 'a second stock row for the same night is rejected');
  ok(await accepts(d, `insert into rate_rules(room_type_id,rule_type,rate_amount,approval_status) values('${rt}','BASE',100,'APPROVED')`), 'approved base rate accepted');
  ok(await rejects(d, `insert into rate_rules(room_type_id,rule_type,rate_amount,approval_status) values('${rt}','BASE',110,'APPROVED')`), 'a second approved base rate is rejected');
  ok(await accepts(d, `insert into rate_rules(room_type_id,rule_type,rate_amount) values('${rt}','BASE',110)`), 'a pending base rate is accepted');
  ok(await rejects(d, `insert into rate_rules(room_type_id,rule_type,rate_amount,date_from,date_to) values('${rt}','DATE_RANGE',9,'2026-12-02','2026-12-01')`), 'date range ending before it starts is rejected');
  ok(await rejects(d, `insert into rate_rules(room_type_id,rule_type,rate_amount,specific_date) values('${rt}','BASE',9,'2026-12-01')`), 'base rate carrying a date is rejected');
  ok(await rejects(d, `insert into rate_rules(room_type_id,rule_type,rate_amount) values('${rt}','SELECTED_DAY',9)`), 'selected-day rule without days is rejected');
  ok(await rejects(d, `insert into rate_rules(room_type_id,rule_type,rate_amount,approval_status) values('${rt}','BASE',9,'REJECTED')`), 'rate status outside Pending/Approved is rejected');
  ok(await rejects(d, `insert into reservations(reservation_ref,property_id,guest_id,source_id,check_in_date,check_out_date,total_guests) values('X1','${sid}','${gid}',1,'2026-11-01','2026-11-01',1)`), 'check-out on the check-in date is rejected');
  const rid = (await d.q(`insert into reservations(reservation_ref,property_id,guest_id,source_id,check_in_date,check_out_date,total_guests) values('X2','${sid}','${gid}',1,'2026-11-01','2026-11-02',1) returning reservation_id`))[0].reservation_id;
  ok(await rejects(d, `update reservations set status='NO_SHOW' where reservation_id='${rid}'`), 'a reservation status outside the allowed list is rejected');
  const fid = (await d.q(`insert into folios(reservation_id,currency_code) values('${rid}','MYR') returning folio_id`))[0].folio_id;
  ok(await rejects(d, `insert into folios(reservation_id,currency_code) values('${rid}','MYR')`), 'a second folio for one reservation is rejected');
  ok(await accepts(d, `insert into payments(folio_id,amount,currency_code,method,gateway_reference) values('${fid}',10,'MYR','ONLINE','GW-1')`) &&
     await rejects(d, `insert into payments(folio_id,amount,currency_code,method,gateway_reference) values('${fid}',10,'MYR','ONLINE','GW-1')`), 'a duplicate gateway reference is rejected');
  ok(await accepts(d, `insert into payments(folio_id,amount,currency_code,method) values('${fid}',5,'MYR','CASH'); insert into payments(folio_id,amount,currency_code,method) values('${fid}',5,'MYR','CASH')`), 'payments without a gateway reference can repeat');
  ok(await accepts(d, `insert into users(property_id,role_id,full_name,email,password_hash) values('${sid}',3,'U','Staff@Example.test','x')`) &&
     await rejects(d, `insert into users(property_id,role_id,full_name,email,password_hash) values('${sid}',3,'U2','staff@example.test','x')`), 'email is unique ignoring upper/lower case');
  await d.exec(`insert into rooms(room_type_id,room_number) values('${rt}','305')`);
  ok(await rejects(d, `insert into rooms(room_type_id,room_number) values('${rt}','305')`), 'a duplicate room number is rejected');
  ok(await rejects(d, `delete from room_types where room_type_id='${rt}'`), 'a room type that is in use cannot be deleted');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
