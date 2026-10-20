// Runs every test file in its own process (each with its own in-memory PostgreSQL) and totals the results.
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
let pass = 0, fail = 0, files = 0;
for (const f of fs.readdirSync(__dirname).filter(f => /^\d+_.*\.js$/.test(f)).sort()) {
  console.log(`\n=== ${f}`);
  const r = spawnSync('node', [path.join(__dirname, f)], { encoding: 'utf8', env: process.env });
  process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || ''); files++;
  if (m) { pass += +m[1]; fail += +m[2]; } else { fail++; console.log('FAIL  test file did not finish: ' + f); }
}
console.log(`\nTOTAL: ${pass} passed, ${fail} failed, ${files} test files`);
process.exit(fail ? 1 : 0);
