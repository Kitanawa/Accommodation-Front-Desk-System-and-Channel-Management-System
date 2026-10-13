// Runs any question file through the real pipeline and prints a score per category.
//   DB_NAME=frontdesk_ai_large node test/run_file.js test/cases_large.json
// Self-contained: works with the older backend too (it only needs src/chat.js and src/db.js).
import fs from 'node:fs';
import { handleChat } from '../src/chat.js';
import { pool } from '../src/db.js';

const file = process.argv[2] || 'test/cases_large.json';
const cases = JSON.parse(fs.readFileSync(file, 'utf8'));

function check(c, r) {
  const p = [];
  if (c.intent && r.request.intent !== c.intent) p.push(`intent ${r.request.intent} != ${c.intent}`);
  if (c.type && r.request.room_type !== c.type) p.push(`type ${r.request.room_type} != ${c.type}`);
  if (c.from && r.request.from !== c.from) p.push(`from ${r.request.from} != ${c.from}`);
  if (c.to && r.request.to !== c.to) p.push(`to ${r.request.to} != ${c.to}`);
  if (c.guests && r.request.guests !== c.guests) p.push(`guests ${r.request.guests} != ${c.guests}`);
  for (const s of c.contains || []) if (!r.reply.includes(s)) p.push(`reply missing "${s}"`);
  for (const s of c.notContains || []) if (r.reply.includes(s)) p.push(`reply should not contain "${s}"`);
  return p;
}

const by = {};
const fails = [];
for (const c of cases) {
  const r = await handleChat(c.q, { staffUser: 'test-runner' });
  const problems = check(c, r);
  const k = c.cat || 'core';
  by[k] ||= { ok: 0, n: 0 };
  by[k].n++;
  if (problems.length) fails.push({ c, problems, reply: r.reply.split('\n')[0] }); else by[k].ok++;
}
const ok = cases.length - fails.length;
console.log(`\nScore: ${ok}/${cases.length} (${Math.round((ok / cases.length) * 100)}%)\n`);
for (const [k, v] of Object.entries(by)) console.log(`${k.padEnd(24)} ${String(v.ok).padStart(3)}/${String(v.n).padEnd(3)} ${Math.round((v.ok / v.n) * 100)}%`);
if (process.env.SHOW_FAILS !== '0') for (const f of fails) console.log(`\nFAIL [${f.c.id || f.c.cat}] ${f.c.q}\n  - ${f.problems.slice(0, 3).join('\n  - ')}\n  reply: ${f.reply}`);
await pool.query("DELETE FROM ai_audit_log WHERE staff_user = 'test-runner'");
await pool.end();
