process.env.PGLITE_DIR = 'memory';           // every test file runs against a throw-away in-memory PostgreSQL
const { DEMO } = require('../seed');
let pass = 0, fail = 0, base; const tok = {};
const ok = (cond, label) => { cond ? pass++ : fail++; console.log((cond ? 'PASS  ' : 'FAIL  ') + label); };
const summary = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
async function boot() {
  const server = await require('../server').start(0); base = 'http://localhost:' + server.address().port;
  for (const k of ['admin', 'manager', 'frontdesk']) tok[k] = (await api('POST', '/api/login', { email: DEMO[k].email, password: DEMO[k].password })).body.token;
  return server;
}
async function api(method, url, body, who, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + (tok[who] || who) } : {}), ...extraHeaders };
  const r = await fetch(base + url, { method, headers, body: body === undefined || body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j, headers: r.headers };
}
module.exports = { ok, summary, boot, api, tok, DEMO };
