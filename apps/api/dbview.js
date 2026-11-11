// Shows rows of a table in the built-in database. Stop the API first (Ctrl+C), because only one program can open the built-in database at a time.
// Usage:  node dbview.js room_stock          node dbview.js audit_records 10          node dbview.js            (lists tables)
(async () => {
  const [table, n] = process.argv.slice(2), d = await require('./db').connect();
  if (!table) { console.table((await d.q("select table_name from information_schema.tables where table_schema='public' order by 1")).map(r => r.table_name)); return process.exit(0); }
  if (!/^[a-z_]+$/.test(table)) { console.log('Table names use lowercase letters and _ only.'); return process.exit(1); }
  const order = { audit_records: 'audit_id desc', room_stock: 'stock_date', reservation_holds: 'created_at desc', reservations: 'created_at desc' }[table];
  const rows = await d.q(`select * from ${table}${order ? ' order by ' + order : ''} limit ${Math.min(Number(n) || 15, 200)}`);
  console.table(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 19) : (typeof v === 'object' && v ? JSON.stringify(v).slice(0, 60) : (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(v) ? v.slice(0, 8) : (v.length > 40 ? v.slice(0, 40) : v)))]))));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
