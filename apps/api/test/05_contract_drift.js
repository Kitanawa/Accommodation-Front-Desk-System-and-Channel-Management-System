// S055: the contract document cannot drift from the code.
const { ok, summary } = require('./helpers');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { app } = require('../server');
const { endpoints } = require('../docs/contract');
const { CODES } = require('../errors');

const registered = new Set();
for (const l of app._router.stack) if (l.route && l.route.path.startsWith('/api')) for (const m of Object.keys(l.route.methods)) registered.add(`${m.toUpperCase()} ${l.route.path.replace(/:id/g, '{id}')}`);
const implemented = new Set(endpoints.filter(e => e.status === 'implemented').map(e => `${e.m} ${e.p}`));
const planned = endpoints.filter(e => e.status !== 'implemented');

const missingInContract = [...registered].filter(r => !implemented.has(r)), missingInServer = [...implemented].filter(r => !registered.has(r));
ok(missingInContract.length === 0, 'every route in the server is documented in the contract' + (missingInContract.length ? ': ' + missingInContract.join(', ') : ''));
ok(missingInServer.length === 0, 'every endpoint marked implemented exists in the server' + (missingInServer.length ? ': ' + missingInServer.join(', ') : ''));
ok(planned.every(e => !registered.has(`${e.m} ${e.p}`) && /^S\d{3}$/.test(e.status)), 'any endpoint still planned is not built yet and names the subtask that builds it');
ok(endpoints.every(e => (e.err || []).every(c => CODES[c])), 'every error code named in the contract is in the error catalog');
ok(endpoints.every(e => new Set(endpoints.filter(x => x.m === e.m && x.p === e.p)).size === 1), 'no endpoint is listed twice');

const files = ['API_CONTRACT.md', 'openapi.yaml'].map(f => path.join(__dirname, '..', 'docs', f));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = files.map(sha);
const r = spawnSync('node', [path.join(__dirname, '..', 'docs', 'build.js')], { encoding: 'utf8' });
ok(r.status === 0 && /valid OpenAPI 3.0/.test(r.stdout), 'openapi.yaml validates as OpenAPI 3.0');
ok(JSON.stringify(before) === JSON.stringify(files.map(sha)), 'the contract files on disk are up to date with docs/contract.js (rebuilding changes nothing)');
summary();
