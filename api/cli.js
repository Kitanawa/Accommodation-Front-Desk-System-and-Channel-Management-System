// Database commands:  node cli.js migrate | rollback [n|all] | status | seed [fds] | reset
const M = require('./migrate');
(async () => {
  const d = await require('./db').connect();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'migrate') console.log('Applied:', (await M.up(d)).join(', ') || 'nothing (already up to date)');
  else if (cmd === 'rollback') console.log('Rolled back:', (await M.down(d, { steps: arg === 'all' ? Infinity : Number(arg) || 1 })).join(', ') || 'nothing');
  else if (cmd === 'status') (await M.status(d)).forEach(s => console.log((s.applied ? '[x] ' : '[ ] ') + s.version));
  else if (cmd === 'seed') { const [n] = await d.q('select count(*)::int c from users'); if (n.c) console.log('Database already has data. Run "reset" to start over.'); else { await require('./seed').seed(d, { taxPct: arg === 'fds' ? 16 : 0 }); console.log('Anonymous fixtures loaded' + (arg === 'fds' ? ' (tax 16%: SST 6% + service 10%).' : '.')); } }
  else if (cmd === 'reset') { await M.down(d, { steps: Infinity }); await M.up(d); await require('./seed').seed(d); console.log('Database reset and seeded.'); }
  else console.log('Usage: node cli.js migrate | rollback [n|all] | status | seed [fds] | reset');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
