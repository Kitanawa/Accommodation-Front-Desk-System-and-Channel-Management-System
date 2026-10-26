// Runs every test file in its own process and totals the results.
// Default: each file gets its own in-memory embedded PostgreSQL.
// With TEST_PG_URL (a connection string to any database on a real PostgreSQL server, for example .../postgres),
// each file gets its own new database on that server, which is dropped afterwards. Needs the right to create databases.
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
(async () => {
  let pass = 0, fail = 0, files = 0, admin = null;
  const base = process.env.TEST_PG_URL;
  if (base) { const { Client } = require('pg'); admin = new Client({ connectionString: base }); await admin.connect();
    const [v] = (await admin.query('show server_version')).rows; console.log('Real PostgreSQL server, version ' + v.server_version); }
  for (const f of fs.readdirSync(__dirname).filter(f => /^\d+_.*\.js$/.test(f)).sort()) {
    console.log(`\n=== ${f}`);
    const env = { ...process.env }; delete env.TEST_PG_URL; let name = null;
    if (admin) {
      name = 'fds_test_' + f.slice(0, 2) + '_' + process.pid;
      await admin.query(`drop database if exists ${name} with (force)`); await admin.query(`create database ${name}`);
      const u = new URL(base); u.pathname = '/' + name; env.DATABASE_URL = u.toString();
    }
    const r = spawnSync('node', [path.join(__dirname, f)], { encoding: 'utf8', env });
    process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
    const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || ''); files++;
    if (m) { pass += +m[1]; fail += +m[2]; } else { fail++; console.log('FAIL  test file did not finish: ' + f); }
    if (admin) await admin.query(`drop database if exists ${name} with (force)`);
  }
  if (admin) await admin.end();
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed, ${files} test files`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
