// npm run verify-readonly : proves the assistant's database user cannot write.
try { process.loadEnvFile(); } catch { /* no .env file */ }
import { getPool, closePool, configured } from '../src/db.js';
import { runBattery } from '../src/verify.js';

if (!configured()) { console.error('AI_DATABASE_URL is not set in .env.'); process.exit(2); }
try {
  const { guard, results } = await runBattery(getPool());
  console.log(`Database user: ${guard.user}`);
  if (!guard.ok) {
    console.log('FAIL: this database user could write. Nothing was tried.');
    guard.problems.forEach((p) => console.log(`  - ${p}`));
    process.exitCode = 1;
  } else {
    for (const r of results) console.log(`${r.blocked ? 'PASS' : 'FAIL'}  ${r.name}  ->  ${r.detail}`);
    const bad = results.filter((r) => !r.blocked).length;
    console.log(bad ? `\n${bad} attempt(s) were NOT blocked. Do not use this database user.` : `\nAll ${results.length} attempts were refused by PostgreSQL. The assistant's database user is read-only.`);
    process.exitCode = bad ? 1 : 0;
  }
} catch (e) { console.error(`Could not run the check: ${e.message}`); process.exitCode = 2; }
await closePool();
