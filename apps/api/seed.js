// Anonymous seed fixtures (S054). Everything here is invented: no real people, hotels, emails, phone or ID numbers.
//   emails end in @fds.test (staff) or @example.test (guests); phones are +60 12-000 0000; ID numbers are X000000n.
const S = require('./service');
const { hashPassword } = require('./password');

// Demo passwords meet the password rules (S058) and do not contain the account's own name.
const DEMO = {
  admin:     { name: 'Administrator',    email: 'admin@fds.test',      password: 'Orchid-Demo-2026',  role: 1, approve: true },
  manager:   { name: 'Owner Manager',    email: 'manager@fds.test',    password: 'Lantern-Demo-2026', role: 2, approve: false },  // "Approve rates: Configurable" -> off
  frontdesk: { name: 'Front Desk Staff', email: 'frontdesk@fds.test',  password: 'Meadow-Demo-2026',  role: 3, approve: false },
};
const SECOND = { email: 'frontdesk.b@fds.test', password: 'Willow-Demo-2026' };    // only with { secondProperty: true }

async function seed(d, { secondProperty = false, taxPct = 0 } = {}) {
  const q = d.q;
  const [prop] = await q("insert into properties(name,address,currency_code) values('Harbour View Hotel (demo)','1 Example Road, Sample City','MYR') returning property_id");
  for (const u of Object.values(DEMO))
    await q('insert into users(property_id,role_id,full_name,email,password_hash,can_approve_rates) values($1,$2,$3,$4,$5,$6)',
      [prop.property_id, u.role, u.name, u.email, await hashPassword(u.password), u.approve]);

  const cats = {};
  for (const c of ['Standard', 'Deluxe', 'Suite']) cats[c] = (await q('insert into room_categories(property_id,name) values($1,$2) returning category_id', [prop.property_id, c]))[0].category_id;
  const types = [
    ['Standard', 'Standard Twin', 2, 1, 'Compact room with two single beds', ['WiFi', 'Air-con', 'TV'], 'Twin beds, 20 sqm', ['101', '102', '103', '104', '105', '106']],
    ['Deluxe', 'Deluxe King', 3, 1, 'Spacious room with king bed and city view', ['WiFi', 'Air-con', 'Minibar', 'Balcony'], 'King bed, 32 sqm', ['201', '202', '203', '204']],
    ['Suite', 'Family Suite', 4, 2, 'Two-room suite with living area', ['WiFi', 'Air-con', 'Minibar', 'Kitchenette'], '2 rooms, 55 sqm', ['301', '302']],
  ];
  const tid = {};
  for (const [cat, name, mg, mn, desc, fac, layout, rooms] of types) {
    const [t] = await q('insert into room_types(category_id,name,max_guests,min_nights,description,facilities,layout_info) values($1,$2,$3,$4,$5,$6::jsonb,$7) returning room_type_id',
      [cats[cat], name, mg, mn, desc, JSON.stringify(fac), layout]);
    tid[name] = t.room_type_id;
    for (const rn of rooms) await q('insert into rooms(room_type_id,room_number) values($1,$2)', [t.room_type_id, rn]);
    for (let i = -2; i <= 120; i++) await q('insert into room_stock(room_type_id,stock_date,total_rooms) values($1,$2,$3)', [t.room_type_id, S.addDays(S.today(), i), rooms.length]);
  }
  const rule = (t, type, amt, extra = {}, status = 'APPROVED') => q(
    `insert into rate_rules(room_type_id,rule_type,rate_amount,date_from,date_to,selected_days,specific_date,priority,approval_status)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tid[t], type, amt, extra.from || null, extra.to || null, extra.days || null, extra.date || null, extra.priority ?? null, status]);
  await rule('Standard Twin', 'BASE', 120);
  await rule('Standard Twin', 'SELECTED_DAY', 150, { days: [5, 6], priority: 1 });                    // Fri, Sat
  await rule('Deluxe King', 'BASE', 180);
  await rule('Deluxe King', 'DATE_RANGE', 240, { from: '2026-12-20', to: '2027-01-03', priority: 2 });
  await rule('Family Suite', 'BASE', 320);
  await rule('Family Suite', 'SPECIFIC_DATE', 380, { date: '2026-12-31', priority: 3 }, 'PENDING');   // waits for approval

  // `seed fds`: the staff web app prices every folio with SST 6% + service charge 10%, so the property uses that one standard for the web app, the website and the mobile app
  if (taxPct) await q("insert into property_settings(property_id,tax_name,tax_rate_pct) values($1,'SST 6% + Service 10%',$2) on conflict (property_id) do update set tax_name=excluded.tax_name, tax_rate_pct=excluded.tax_rate_pct", [prop.property_id, taxPct]);
  const [adm] = await q('select user_id from users where email=$1', [DEMO.admin.email]);
  const t = S.today();
  await d.tx(async tx => {
    const mk = (n, name, type, from, to, guests, src, extra = {}) => S.createReservation(tx, prop.property_id, {
      guest: { full_name: name, phone: '+60 12-000 0000', email: `guest.${n}@example.test`, nationality: 'Malaysian', id_passport_no: `X000000${n}`, ...extra },
      room_type_id: tid[type], check_in: from, check_out: to, total_guests: guests, source_id: src, estimated_arrival: '15:00', special_requests: extra.special_requests }, adm.user_id);
    await mk(1, 'Guest One', 'Standard Twin', t, S.addDays(t, 2), 2, 1);
    await mk(2, 'Guest Two', 'Deluxe King', S.addDays(t, 1), S.addDays(t, 4), 2, 4, { special_requests: 'High floor' });
    await mk(3, 'Guest Three', 'Family Suite', S.addDays(t, 5), S.addDays(t, 8), 4, 5);
  });

  if (secondProperty) await addSecondProperty(d);
  return { property_id: prop.property_id };
}

// A second, separate property: used to prove that one property cannot see another's records (S057).
async function addSecondProperty(d) {
  const q = d.q, t = S.today();
  const [p2] = await q("insert into properties(name,address,currency_code) values('Riverside Test Property (demo)','2 Example Road, Sample City','MYR') returning property_id");
  await q('insert into users(property_id,role_id,full_name,email,password_hash) values($1,3,$2,$3,$4)', [p2.property_id, 'Second Property Staff', SECOND.email, await hashPassword(SECOND.password)]);
  const [c2] = await q("insert into room_categories(property_id,name) values($1,'Standard') returning category_id", [p2.property_id]);
  const [t2] = await q("insert into room_types(category_id,name,max_guests) values($1,'Single Room',1) returning room_type_id", [c2.category_id]);
  for (const rn of ['B101', 'B102']) await q('insert into rooms(room_type_id,room_number) values($1,$2)', [t2.room_type_id, rn]);
  for (let i = -2; i <= 120; i++) await q('insert into room_stock(room_type_id,stock_date,total_rooms) values($1,$2,2)', [t2.room_type_id, S.addDays(t, i)]);
  await q("insert into rate_rules(room_type_id,rule_type,rate_amount,approval_status) values($1,'BASE',90,'APPROVED')", [t2.room_type_id]);
  return { property_id: p2.property_id, room_type_id: t2.room_type_id };
}
module.exports = { seed, addSecondProperty, DEMO, SECOND };
