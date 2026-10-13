// Runs the cases in cases.json through the real pipeline (needs the database).
// This is the seed of the client's 200-question accuracy test: add cases, keep the scoring.
import fs from 'node:fs';
import { handleChat } from '../src/chat.js';
import { pool } from '../src/db.js';

const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url)));
let pass = 0;
const fails = [];
for (const c of cases) {
  const r = await handleChat(c.q, { staffUser: 'test-runner' });
  const problems = [];
  if (c.intent && r.request.intent !== c.intent) problems.push(`intent ${r.request.intent} != ${c.intent}`);
  if (c.type && r.request.room_type !== c.type) problems.push(`type ${r.request.room_type} != ${c.type}`);
  if (c.from && r.request.from !== c.from) problems.push(`from ${r.request.from} != ${c.from}`);
  if (c.to && r.request.to !== c.to) problems.push(`to ${r.request.to} != ${c.to}`);
  if (c.guests && r.request.guests !== c.guests) problems.push(`guests ${r.request.guests} != ${c.guests}`);
  for (const s of c.contains || []) if (!r.reply.includes(s)) problems.push(`reply missing "${s}"`);
  for (const s of c.notContains || []) if (r.reply.includes(s)) problems.push(`reply should not contain "${s}"`);
  if (problems.length) fails.push({ q: c.q, problems, reply: r.reply });
  else pass++;
}
console.log(`\nScore: ${pass}/${cases.length} (${Math.round((pass / cases.length) * 100)}%)`);
for (const f of fails) console.log(`\nFAIL: ${f.q}\n  - ${f.problems.join('\n  - ')}\n  reply: ${f.reply.replace(/\n/g, ' | ')}`);
await pool.query("DELETE FROM ai_audit_log WHERE staff_user = 'test-runner'");
await pool.end();
process.exit(fails.length ? 1 : 0);
