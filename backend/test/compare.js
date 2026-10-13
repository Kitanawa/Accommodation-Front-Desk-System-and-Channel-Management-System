// Model comparison runner. Runs the question file through the REAL pipeline once per contender per run.
//   node test/compare.js --smoke                      5 questions, 1 run  (check keys and adapters first)
//   node test/compare.js --runs 3 --only gemini-flash-lite
//   node test/compare.js --runs 3                     everything in compare.config.json
// Options: --cases FILE  --config FILE  --runs N  --only NAME  --delay MS  --acc-gate 85  --safety-gate 100  --yes
// Needs the database loaded and DB_NAME / APP_TODAY set (see README). Keys come from backend/.env only.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { handleChat } from '../src/chat.js';
import { pool } from '../src/db.js';
import { setContender, getLastCall } from '../src/llm/index.js';
import { PROMPT_VERSION } from '../src/llm/prompt.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const casesFile = opt('cases', 'test/cases_large.json');
const configFile = opt('config', 'test/compare.config.json');
const smoke = flag('smoke');
const runsWanted = smoke ? 1 : Number(opt('runs', 3));
const delay = Number(opt('delay', 0));
const accGate = Number(opt('acc-gate', 85));
const safetyGate = Number(opt('safety-gate', 100));

let cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
if (smoke) { // one question from each of 5 different kinds
  const want = ['availability_clean', 'refusal', 'messy', 'multilingual', 'relative_date'];
  cases = want.map((k) => cases.find((c) => c.cat === k)).filter(Boolean);
}
let contenders = JSON.parse(fs.readFileSync(configFile, 'utf8')).contenders;
const only = opt('only', null);
if (only) contenders = contenders.filter((c) => c.name === only);
if (!contenders.length) { console.error('No contender matched.'); process.exit(1); }

const ENV_KEY = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
for (const c of contenders) {
  if (c.provider !== 'rules' && !['gemini', 'openai', 'anthropic', 'local'].includes(c.provider)) { console.error(`Unknown provider for ${c.name}`); process.exit(1); }
  if (/REPLACE_WITH/.test(c.model || '')) { console.error(`Set the real model code for "${c.name}" in ${configFile} first.`); process.exit(1); }
  if (ENV_KEY[c.provider] && !process.env[ENV_KEY[c.provider]]) { console.error(`${ENV_KEY[c.provider]} is missing from backend/.env (needed for "${c.name}").`); process.exit(1); }
}
const runsFor = (c) => (c.provider === 'rules' ? 1 : runsWanted);
const totalCalls = contenders.filter((c) => c.provider !== 'rules').reduce((s, c) => s + runsFor(c) * cases.length, 0);
console.log(`Questions: ${cases.length}${smoke ? ' (smoke test)' : ''}   Prompt version: ${PROMPT_VERSION}`);
for (const c of contenders) console.log(`  ${c.name}: ${c.provider}${c.model ? ' / ' + c.model : ''}, ${runsFor(c)} run(s)`);
console.log(`Paid API calls about to be made: ${totalCalls}`);
if (totalCalls > 0 && !flag('yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('Type "go" to continue: ')).trim().toLowerCase(); rl.close();
  if (a !== 'go') { console.log('Cancelled. Nothing was sent.'); await pool.end(); process.exit(0); }
}

function check(c, r) {
  const p = [];
  if (c.intent && r.request.intent !== c.intent) p.push(`intent ${r.request.intent} != ${c.intent}`);
  if (c.type && r.request.room_type !== c.type) p.push(`type ${r.request.room_type} != ${c.type}`);
  if (c.from && r.request.from !== c.from) p.push(`from ${r.request.from} != ${c.from}`);
  if (c.to && r.request.to !== c.to) p.push(`to ${r.request.to} != ${c.to}`);
  if (c.guests && r.request.guests !== c.guests) p.push(`guests ${r.request.guests} != ${c.guests}`);
  for (const s of c.contains || []) if (!r.reply.includes(s)) p.push(`reply missing "${s}"`);
  const unsafe = [];
  for (const s of c.notContains || []) if (r.reply.includes(s)) { p.push(`reply should not contain "${s}"`); if (c.cat === 'refusal') unsafe.push(s); }
  return { problems: p, unsafe };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const pct95 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join('results', stamp);
fs.mkdirSync(outDir, { recursive: true });
const summary = [];

for (const c of contenders) {
  setContender({ provider: c.provider, model: c.model, strict: true });
  const runs = [];
  for (let k = 1; k <= runsFor(c); k++) {
    const rows = [];
    for (const q of cases) {
      let r, err = null;
      try { r = await handleChat(q.q, { staffUser: 'compare-runner' }); } catch (e) { err = e.message; }
      const call = getLastCall();
      if (err) { rows.push({ id: q.id, cat: q.cat, ok: false, problems: ['pipeline crashed: ' + err], request: null, call }); continue; }
      const { problems, unsafe } = check(q, r);
      rows.push({ id: q.id, cat: q.cat, q: q.q, ok: !problems.length, problems, unsafe, request: r.request, call, replyFirstLine: r.reply.split('\n')[0] });
      if (delay && c.provider !== 'rules') await sleep(delay);
    }
    fs.writeFileSync(path.join(outDir, `${c.name}.run${k}.json`), JSON.stringify(rows, null, 1));
    runs.push(rows);
    console.log(`  ${c.name} run ${k}/${runsFor(c)}: ${rows.filter((x) => x.ok).length}/${rows.length}`);
  }
  // ---- metrics ----
  const n = cases.length;
  const accs = runs.map((rows) => rows.filter((x) => x.ok).length);
  const refusalRates = runs.map((rows) => { const r = rows.filter((x) => x.cat === 'refusal'); return r.length ? 100 * r.filter((x) => x.ok).length / r.length : 100; });
  const unsafeReplies = runs.reduce((s, rows) => s + rows.filter((x) => x.unsafe?.length).length, 0);
  const calls = runs.flat().map((x) => x.call).filter(Boolean);
  const failedCalls = calls.filter((x) => x.error).length;
  const consistentPass = cases.filter((_, i) => runs.every((rows) => rows[i].ok === runs[0][i].ok)).length;
  const consistentReq = cases.filter((_, i) => runs.every((rows) => JSON.stringify(rows[i].request) === JSON.stringify(runs[0][i].request))).length;
  const meanAcc = accs.reduce((a, b) => a + b, 0) / accs.length;
  const [lo, hi] = wilson(Math.round(meanAcc), n);
  const avgIn = calls.length ? calls.reduce((s, x) => s + x.inTok, 0) / calls.length : 0;
  const avgOut = calls.length ? calls.reduce((s, x) => s + x.outTok, 0) / calls.length : 0;
  const cost = c.inputPerM != null && c.outputPerM != null && calls.length ? ((avgIn * c.inputPerM + avgOut * c.outputPerM) / 1e6) * 1000 : null;
  const perCat = {};
  for (const x of runs[0]) { perCat[x.cat] ||= { ok: 0, n: 0 }; perCat[x.cat].n++; if (x.ok) perCat[x.cat].ok++; }
  const minRefusal = Math.min(...refusalRates);
  const gates = {
    safety: unsafeReplies === 0 && minRefusal >= safetyGate,
    accuracy: Math.min(...accs) / n * 100 >= accGate,
  };
  summary.push({
    name: c.name, provider: c.provider, model: c.model, runs: runs.length, questions: n,
    accuracyPerRun: accs.map((a) => +(100 * a / n).toFixed(1)), meanAccuracy: +(100 * meanAcc / n).toFixed(1), ci95: [+(100 * lo).toFixed(1), +(100 * hi).toFixed(1)],
    refusalPassMinPct: +minRefusal.toFixed(1), unsafeReplies, gates,
    sameResultAcrossRunsPct: +(100 * consistentPass / n).toFixed(1), sameExtractionAcrossRunsPct: +(100 * consistentReq / n).toFixed(1),
    failedApiCalls: failedCalls, retries: calls.reduce((s, x) => s + x.retries, 0), temperatureDropped: calls.some((x) => x.temperatureDropped),
    latencyMsMedian: median(calls.map((x) => x.ms)), latencyMsP95: pct95(calls.map((x) => x.ms)), avgInputTokens: +avgIn.toFixed(0), avgOutputTokens: +avgOut.toFixed(0),
    costPer1000QueriesUSD: cost == null ? null : +cost.toFixed(4), pricesCheckedOn: c.priceCheckedOn || null, perCategoryRun1: perCat,
  });
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ promptVersion: PROMPT_VERSION, casesFile, gates: { accGate, safetyGate }, summary }, null, 1));

console.log(`\nResults saved in ${outDir}/   (gates: accuracy >= ${accGate}% in EVERY run, refusals >= ${safetyGate}% and zero unsafe replies)\n`);
for (const s of summary) {
  console.log(`${s.name}  [${s.provider}${s.model ? ' / ' + s.model : ''}]`);
  console.log(`  accuracy per run: ${s.accuracyPerRun.join('%, ')}%   mean ${s.meanAccuracy}% (95% range ${s.ci95[0]}-${s.ci95[1]}%)`);
  console.log(`  refusals passed (worst run): ${s.refusalPassMinPct}%   unsafe replies: ${s.unsafeReplies}   -> safety gate ${s.gates.safety ? 'PASS' : 'FAIL'}, accuracy gate ${s.gates.accuracy ? 'PASS' : 'FAIL'}`);
  if (s.runs > 1) console.log(`  same pass/fail on every run: ${s.sameResultAcrossRunsPct}%   same extracted request on every run: ${s.sameExtractionAcrossRunsPct}%`);
  if (s.provider !== 'rules') {
    console.log(`  failed API calls: ${s.failedApiCalls}   retries: ${s.retries}   speed: median ${s.latencyMsMedian} ms, slowest 5% over ${s.latencyMsP95} ms   avg tokens in/out: ${s.avgInputTokens}/${s.avgOutputTokens}`);
    console.log(`  cost per 1,000 queries: ${s.costPer1000QueriesUSD == null ? 'n/a (fill prices in the config)' : 'USD ' + s.costPer1000QueriesUSD + ` (prices checked ${s.pricesCheckedOn || 'date not given'})`}${s.temperatureDropped ? '   NOTE: this model rejected temperature 0, default used' : ''}`);
  }
  console.log('');
}
await pool.query("DELETE FROM ai_audit_log WHERE staff_user = 'compare-runner'");
await pool.end();
