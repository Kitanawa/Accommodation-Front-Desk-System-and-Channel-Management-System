// Generates docs/API_CONTRACT.md and docs/openapi.yaml from docs/contract.js, then validates the OpenAPI file.
const fs = require('fs'), path = require('path');
const YAML = require('yaml');
const SwaggerParser = require('@apidevtools/swagger-parser');
const { schemas, endpoints, rolesOf } = require('./contract');
const { CODES } = require('../errors');
const P = require('../permissions');
const { POLICY } = require('../password');
const A = require('../auth');

// ---------- types ----------
function sch(t) {
  if (t.endsWith('?')) return { ...sch(t.slice(0, -1)), nullable: true };
  if (t.endsWith('[]')) return { type: 'array', items: sch(t.slice(0, -2)) };
  if (t.startsWith('ref:')) return { $ref: '#/components/schemas/' + t.slice(4) };
  if (t.startsWith('enum:')) return { type: 'string', enum: t.slice(5).split('|') };
  return { uuid: { type: 'string', format: 'uuid' }, date: { type: 'string', format: 'date' }, time: { type: 'string', format: 'time', example: '15:00' },
    datetime: { type: 'string', format: 'date-time' }, int: { type: 'integer' }, number: { type: 'number' }, string: { type: 'string' }, bool: { type: 'boolean' }, object: { type: 'object' } }[t];
}
const objSchema = (props, required = []) => ({ type: 'object', properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sch(v)])), ...(required.length ? { required } : {}) });
const human = t => t.replace('enum:', 'one of ').replace(/\|/g, ', ').replace('ref:', '').replace('uuid', 'UUID').replace(/^int\[\]$/, 'whole numbers').replace('datetime', 'timestamp');
const respSchema = n => n === null ? { type: 'object', properties: { database: { type: 'string' } } } : n.endsWith('[]') ? { type: 'array', items: { $ref: '#/components/schemas/' + n.slice(0, -2) } } : { $ref: '#/components/schemas/' + n };

// ---------- which standard errors every endpoint can return ----------
function errorsFor(e) {
  const out = new Set(e.err || []);
  if (e.who !== 'public') ['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED'].forEach(c => out.add(c));
  if (e.perm && P.MATRIX[e.perm].length < 3) out.add('FORBIDDEN');   // only when some role is actually refused
  if (/\{id\}/.test(e.p) || e.body || e.query) out.add('VALIDATION_ERROR');
  out.add('INTERNAL_ERROR');
  return [...out].sort((a, b) => CODES[a][0] - CODES[b][0] || a.localeCompare(b));
}

// ---------- OpenAPI ----------
function openapi() {
  const paths = {};
  for (const e of endpoints) {
    const params = [];
    for (const [k, v] of Object.entries(e.query || {})) params.push({ name: k, in: 'query', required: v.req, schema: sch(v.type), description: v.note || undefined });
    if (/\{id\}/.test(e.p)) params.push({ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
    const responses = { [e.ok[0]]: { description: 'Success', content: { 'application/json': { schema: respSchema(e.ok[1]) } } } };
    const byStatus = {};
    errorsFor(e).forEach(c => (byStatus[CODES[c][0]] = byStatus[CODES[c][0]] || []).push(c));
    for (const [st, codes] of Object.entries(byStatus)) responses[st] = { description: 'Error code: ' + codes.join(' or '), content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    const op = { tags: [e.tag], summary: e.sum, description: `Who: ${rolesOf(e)}. Status: ${e.status === 'implemented' ? 'implemented' : 'planned for ' + e.status}.`,
      operationId: (e.m + e.p).replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''), 'x-status': e.status, parameters: params.length ? params : undefined, responses };
    if (e.who === 'public') op.security = [];
    if (e.body) op.requestBody = { required: true, content: { 'application/json': { schema: objSchema(Object.fromEntries(Object.entries(e.body).map(([k, v]) => [k, v.type])), Object.entries(e.body).filter(([, v]) => v.req).map(([k]) => k)) } } };
    (paths[e.p.replace(/\/\{id\}/g, '/{id}')] = paths[e.p] || {})[e.m.toLowerCase()] = op;
  }
  const comps = Object.fromEntries(Object.entries(schemas).map(([n, p]) => [n, objSchema(p)]));
  comps.Error = { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'request_id'], properties: {
    code: { type: 'string', enum: Object.keys(CODES) }, message: { type: 'string' }, request_id: { type: 'string', format: 'uuid' },
    fields: { type: 'array', description: 'Present for VALIDATION_ERROR and some conflicts.', items: { type: 'object', required: ['field', 'message'], properties: { field: { type: 'string' }, message: { type: 'string' } } } } } } } };
  return { openapi: '3.0.3', info: { title: 'FDS Backend API', version: '0.3.0', description: 'Accommodation Front Desk System, SRS Draft 2. Contract for S055. Endpoints with an x-status other than implemented are defined now and built in that subtask.' },
    servers: [{ url: 'http://localhost:3000' }], security: [{ bearerAuth: [] }], tags: [...new Set(endpoints.map(e => e.tag))].map(name => ({ name })),
    paths, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token from POST /api/login' } }, schemas: comps } };
}

// ---------- Markdown ----------
const permText = {
  'users.view': 'See staff accounts', 'users.manage_any': 'Create / edit any staff account and role', 'users.manage_frontdesk': 'Create / edit Front Desk accounts',
  'catalog.view': 'See room categories, room types, rooms', 'catalog.manage': 'Manage room categories and types (M09)', 'stock.view': 'See room stock', 'stock.manage': 'Manage room stock (M09)',
  'rates.view_approved': 'See approved rates', 'rates.view_all': 'See pending rates too', 'rates.manage': 'Create / edit rates', 'rates.approve': 'Approve rates',
  'reservations.manage': 'Search availability; create, edit, cancel reservations', 'stay.operate': 'Assign rooms, check in, check out, change room status', 'folio.manage': 'Folio, charges and payments',
  'integration.manage': 'Change channel / integration settings (later)', 'integration.view': 'See channel / integration settings (later)', 'reports.full': 'Full reports (later)', 'reports.operational': 'Dashboard (operational information)', 'audit.view': 'Read the audit log',
};
const mark = (perm, role) => !P.MATRIX[perm].includes(role) ? '-' : (perm === 'rates.approve' && role === 'OWNER_MANAGER') ? 'only if enabled' : (perm === 'users.manage_frontdesk' && role === 'OWNER_MANAGER') ? 'Front Desk only' : 'Yes';
const field = (k, v) => `| \`${k}\` | ${human(v.type)} | ${v.req ? 'Yes' : 'No'} | ${v.note} |`;

function markdown() {
  const impl = endpoints.filter(e => e.status === 'implemented').length, planned = endpoints.length - impl;
  const L = [];
  const w = s => L.push(s);
  w(`# FDS API Contract (S055)

Version 0.3, October 2026. Owner: Chester (backend). Consumers: Qiwei (front end), Ivan (environment, audit events). Business rules: Eric.

This file is generated from \`docs/contract.js\` (the same file produces \`openapi.yaml\`), and a test checks that every endpoint marked *implemented* really exists in the server and that none is missing here.

**Status:** all ${impl} endpoints run today${planned ? `; ${planned} more are defined for later subtasks and marked with the subtask that builds them` : ''}.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | \`http://localhost:3000\` in development. All paths start with \`/api\`. |
| Format | JSON in and out, UTF-8, header \`Content-Type: application/json\`. |
| Authentication | \`Authorization: Bearer <token>\` on every call except those marked Public. |
| Versioning | None in the path. This file's version changes when a field is removed or renamed. Adding fields is not a breaking change, so ignore fields you do not know. |
| Success body | The resource itself, or an array. No wrapper object. Creating something returns 201; everything else 200. |
| Lists | A plain array, at most 200 rows, newest first. There is no pagination yet; when it is added it will use \`limit\` and \`offset\` query parameters without changing existing responses. |
| Empty values | A missing optional value is \`null\`, never an empty string. Send \`null\` or leave the field out. |
| Cross-origin | CORS is open (\`*\`) so a front end on another port can call the API. |
| Request id | Every response has an \`X-Request-Id\` header. Errors repeat it in the body. Quote it when reporting a problem. |

## 2. Identifiers

| Kind | Format | Example |
|---|---|---|
| Resource ids (\`user_id\`, \`reservation_id\`, \`room_id\`, \`room_type_id\`, \`rate_rule_id\`, \`folio_id\`, \`guest_id\`, \`charge_id\`, \`payment_id\`, \`session_id\`, \`property_id\`) | UUID v4, lower case | \`3f2a9c10-5b1e-4c7a-9d2e-8b1c4e22a001\` |
| Lookup ids (\`source_id\`, \`role_id\`, \`status_id\`) | Small whole number. Prefer the \`code\` / \`name\` fields in screens. | \`4\` |
| \`audit_id\` | Whole number, increasing | \`10452\` |
| \`reservation_ref\` | Human reference the guest and staff read out: \`R-\` plus 6 capital letters or digits. Not an id: use \`reservation_id\` in URLs. | \`R-K3F9QA\` |

A resource id in a URL that is not a UUID returns \`400 VALIDATION_ERROR\` (field \`id\`). A well-formed id that does not exist in your property returns \`404 NOT_FOUND\`.

## 3. Data formats

| Type | Format | Example |
|---|---|---|
| Date | \`YYYY-MM-DD\`, property local date (Kuching, UTC+8) | \`2026-11-01\` |
| Time of day | \`HH:MM\` | \`15:00\` |
| Timestamp | ISO 8601 in UTC with \`Z\` | \`2026-10-16T05:57:00.000Z\` |
| Money | JSON number with at most 2 decimals, in the property currency (MYR). Never a string. | \`260.00\` is sent as \`260\` |
| Status and type values | Upper-case words with underscores, exactly as listed per field | \`CHECKED_IN\` |
| Check-out date | Exclusive: a stay from 1 Nov to 3 Nov uses the nights of 1 Nov and 2 Nov. | |
| Weekday numbers | 0 = Sunday to 6 = Saturday (\`selected_days\`) | \`[5, 6]\` = Friday, Saturday |

## 4. Sign-in and sessions

- \`POST /api/login\` returns a \`token\` and its \`expires_at\`. Keep the token in memory or session storage and send it as a Bearer token.
- A session lasts at most **${A.TTL_HOURS} hours** and ends after **${A.IDLE_MINUTES} minutes without any request**. Both are settings (\`SESSION_TTL_HOURS\`, \`SESSION_IDLE_MINUTES\`).
- The server keeps sessions in the database and can end them at any time. Logging out, a password change, deactivating the account or an administrator revoking sessions all end them. The next call returns \`401 SESSION_REVOKED\`. A session that ran out returns \`401 SESSION_EXPIRED\`. The front end should react to any 401 by showing the sign-in screen.
- **${A.MAX_FAILS} wrong passwords in a row** lock the account for **${A.LOCK_MINUTES} minutes** (\`429 ACCOUNT_LOCKED\`), even for the correct password. An administrator reset also unlocks it.
- A wrong password and an unknown email give the identical answer (\`INVALID_CREDENTIALS\`) so the API does not reveal which emails exist.
- The role is read from the database on every request. A role change or deactivation applies immediately; the token does not carry the role.
- Passwords are stored only as scrypt hashes. Tokens are stored only as SHA-256 hashes. Neither ever appears in a response.

## 5. Roles, permissions and property scope

Every endpoint is checked on the server (SRS section 4). Hiding a button in the screen is not security. The "Who" line of each endpoint comes from this table.

| Permission | What it covers | Administrator | Manager | Front Desk |
|---|---|---|---|---|`);
  for (const k of Object.keys(P.MATRIX)) w(`| \`${k}\` | ${permText[k]} | ${mark(k, 'ADMINISTRATOR')} | ${mark(k, 'OWNER_MANAGER')} | ${mark(k, 'FRONT_DESK')} |`);
  w(`
- **Approve rates is Configurable for Managers.** A Manager can approve only when \`can_approve_rates\` is true on their account (shown in \`GET /api/me\`).
- **Manage users: Manager is "Limited".** This contract reads that as: a Manager can see all accounts and create / edit / reset Front Desk accounts only; only an Administrator can touch Administrator and Manager accounts, roles and \`can_approve_rates\`. *(Assumption, see section 9.)*
- **Property scope.** Every record belongs to one property and a user only ever sees their own property's records: reservations, rooms, room types, rates, users and audit records. A record from another property returns \`404 NOT_FOUND\`, exactly as if it did not exist, never 403.
- Calling an endpoint your role may not use returns \`403 FORBIDDEN\`.

## 6. Errors

Every error, from every endpoint, has this shape and nothing else:

\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the fields listed.",
    "fields": [
      { "field": "check_in", "message": "Check-in cannot be in the past." },
      { "field": "guest.full_name", "message": "Guest full name is required." }
    ],
    "request_id": "6f1c2a9e-0d3b-4c61-8c7e-1f2a3b4c5d6e"
  }
}
\`\`\`

- \`code\` is stable and meant for programs: branch on it. \`message\` is plain English meant for people and may be shown as is; do not branch on it.
- \`fields\` is present for \`VALIDATION_ERROR\` and lists **every** wrong field at once. \`field\` is the name in the request body (or query); a dot means a nested field.
- The HTTP status is fixed per code (table below). Responses are never 200 with an error inside.
- \`request_id\` equals the \`X-Request-Id\` response header.

| Code | HTTP | Meaning |
|---|---|---|`);
  for (const [c, [s, m]] of Object.entries(CODES)) w(`| \`${c}\` | ${s} | ${m} |`);
  w(`
Examples:

\`\`\`json
{ "error": { "code": "SOLD_OUT", "message": "Family Suite is sold out on 2026-11-02.", "request_id": "..." } }
{ "error": { "code": "UNAUTHENTICATED", "message": "Please sign in.", "request_id": "..." } }
{ "error": { "code": "ACCOUNT_LOCKED", "message": "Too many wrong passwords. Try again in 15 minute(s).", "request_id": "..." } }
\`\`\`

## 7. Example: sign in, then book

\`\`\`
POST /api/login
{ "email": "frontdesk@fds.test", "password": "Meadow-Demo-2026" }

200
{ "token": "q3...", "expires_at": "2026-10-16T13:30:00.000Z",
  "user": { "user_id": "8b1c...", "name": "Front Desk Staff", "email": "frontdesk@fds.test",
            "role": "FRONT_DESK", "can_approve_rates": false, "property_id": "3f2a..." } }
\`\`\`

\`\`\`
POST /api/reservations          (Authorization: Bearer q3...)
{ "guest": { "full_name": "Guest One", "phone": "+60 12-000 0000" },
  "room_type_id": "a001...", "check_in": "2026-11-01", "check_out": "2026-11-03",
  "total_guests": 2, "source_id": 1, "estimated_arrival": "15:00" }

201
{ "reservation_id": "b701...", "reservation_ref": "R-K3F9QA" }
\`\`\`

## 8. Endpoint reference
`);
  const tags = [...new Set(endpoints.map(e => e.tag))];
  for (const tag of tags) {
    w(`### ${tag}\n`);
    w('| Endpoint | Who | Status | What it does |\n|---|---|---|---|');
    endpoints.filter(e => e.tag === tag).forEach(e => w(`| \`${e.m} ${e.p}\` | ${rolesOf(e)} | ${e.status === 'implemented' ? 'Implemented' : 'Planned ' + e.status} | ${e.sum} |`));
    w('');
    for (const e of endpoints.filter(e => e.tag === tag && (e.body || e.query || (e.err && e.err.length)))) {
      w(`**\`${e.m} ${e.p}\`** returns ${e.ok[0]} ${e.ok[1] ? '`' + e.ok[1] + '`' : 'JSON'}. Errors: ${errorsFor(e).filter(c => !['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'INTERNAL_ERROR'].includes(c)).map(c => '`' + c + '`').join(', ') || 'only the standard ones'}.\n`);
      for (const [label, set] of [['Query parameters', e.query], ['Body fields', e.body]]) if (set) {
        w(`| ${label} | Type | Required | Notes |\n|---|---|---|---|`); Object.entries(set).forEach(([k, v]) => w(field(k, v))); w('');
      }
    }
  }
  w(`## 9. Rules that are assumptions (the SRS does not set them)

Please confirm or change these in review; each one is easy to change before the front end is built.

1. **Session lifetime:** ${A.TTL_HOURS} hours, ${A.IDLE_MINUTES} minutes idle. **Lockout:** ${A.MAX_FAILS} wrong passwords, ${A.LOCK_MINUTES} minutes.
2. **Password rules (S058):** ${POLICY.rules.map(r => r.replace(/\.$/, '')).join('; ')}.
3. **"Manager: Limited" for user management** means Front Desk accounts only (section 5).
4. **Audit log** is visible to Administrator and Manager only (the SRS matrix has no audit row).
5. **Rate precedence** (FR-17 is "to be confirmed"): higher \`priority\` wins; on a tie Specific Date, then Date Range, then Selected Day, then Base. Date Range includes both end dates.
6. **A changed approved Base Rate** is refused (\`BASE_RATE_EXISTS\`), because the SRS does not say how a new rate replaces an approved one.
7. **No pagination yet**, lists return at most 200 rows.
8. **Statuses** (\`CONFIRMED\`, \`CHECKED_IN\`, \`CHECKED_OUT\`, \`CANCELLED\`; \`UNPAID\`, \`PARTIAL\`, \`PAID\`) come from the functional requirements; the SRS does not list them.

## 10. Change log

| Version | Change |
|---|---|
| 0.2 | First contract: conventions, identifiers, error catalog, 25 implemented endpoints, 11 planned. |
| 0.3 | S056 and S058 built: the 11 planned endpoints (sessions, password rules and change, staff accounts) are now implemented. No field removed or renamed. |
`);
  return L.join('\n');
}

(async () => {
  const doc = openapi();
  fs.writeFileSync(path.join(__dirname, 'openapi.yaml'), YAML.stringify(doc, { lineWidth: 0 }));
  fs.writeFileSync(path.join(__dirname, 'API_CONTRACT.md'), markdown());
  await SwaggerParser.validate(path.join(__dirname, 'openapi.yaml'));
  console.log(`openapi.yaml is a valid OpenAPI 3.0 file: ${Object.keys(doc.paths).length} paths, ${Object.keys(doc.components.schemas).length} schemas`);
  console.log('API_CONTRACT.md written');
})().catch(e => { console.error(e.message); process.exit(1); });
