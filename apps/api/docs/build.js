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
    for (const [k, v] of Object.entries(e.headers || {})) params.push({ name: k, in: 'header', required: v.req, schema: sch(v.type), description: v.note || undefined });
    for (const [, pn] of e.p.matchAll(/\{(\w+)\}/g)) params.push({ name: pn, in: 'path', required: true, schema: pn === 'kind' ? sch('enum:ROOM_TYPE|RATE|ADD_ON') : { type: 'string', format: 'uuid' } });
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
  return { openapi: '3.0.3', info: { title: 'FDS Backend API', version: '0.11.0', description: 'Accommodation Front Desk System, SRS Draft 2. Contract for S055. Endpoints with an x-status other than implemented are defined now and built in that subtask.' },
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

Version 0.11, November 2026. Owner: Chester (backend). Consumers: Qiwei (front end), Ivan (environment, audit events). Business rules: Eric.

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
| Lists | A plain array, newest first. Most lists return at most 200 rows. \`GET /api/reservations\` is paged (S082): \`page\` and \`page_size\` query parameters, and the headers \`X-Total-Count\`, \`X-Page\`, \`X-Page-Size\`, \`X-Total-Pages\`. The body stays a plain array. |
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


### 4a. The FDS web app (apps/fds-web)

The web app signs in with a **cookie** and has its own formats, so these endpoints sit beside the main ones and call the same code. Every rule, audit record and session rule is shared.

| | Main API | Web app endpoints (\`/api/auth/*\`, \`/api/staff*\`) |
|---|---|---|
| Credential | \`Authorization: Bearer <token>\` | HttpOnly cookie \`fds_session\` (also accepted by every other endpoint) |
| Changing requests with the cookie | n/a | must send the header \`X-App-Request: 1\`, else \`403 FORBIDDEN\` |
| Role names | \`ADMINISTRATOR\`, \`OWNER_MANAGER\`, \`FRONT_DESK\` | \`admin\`, \`manager\`, \`front_desk\` |
| Account state | \`is_active\` true / false | \`status\` \`active\` / \`disabled\` (\`pending\` is not supported) |
| Errors | \`{ "error": { "code", "message", "fields", "request_id" } }\` | \`{ "error": "text", "code", "fields", "request_id" }\`: the text joins the field messages |

The cookie is \`HttpOnly; SameSite=Lax; Path=/\` and lasts as long as the session. Set \`COOKIE_SECURE=true\` (or serve over HTTPS behind a proxy that sends \`X-Forwarded-Proto: https\`) to add \`Secure\`.
Run the API on port **3001** (\`set PORT=3001\`): that is where the web app's dev server forwards \`/api\`.

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
    for (const e of endpoints.filter(e => e.tag === tag && (e.body || e.query || e.headers || (e.err && e.err.length)))) {
      w(`**\`${e.m} ${e.p}\`** returns ${e.ok[0]} ${e.ok[1] ? '`' + e.ok[1] + '`' : 'JSON'}. Errors: ${errorsFor(e).filter(c => !['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'INTERNAL_ERROR'].includes(c)).map(c => '`' + c + '`').join(', ') || 'only the standard ones'}.\n`);
      for (const [label, set] of [['Headers', e.headers], ['Query parameters', e.query], ['Body fields', e.body]]) if (set) {
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
6. **Changing an approved rate** (S068): the change is a new PENDING rate (\`POST /api/rates/{id}/revise\`). The approved rate stays in force until the change is approved and its \`effective_from\` night arrives (default: the day it is approved). A second approved Base Rate created the old way is still refused (\`BASE_RATE_EXISTS\`). Existing reservations keep the price recorded when they were made.
7. **Pagination:** only \`GET /api/reservations\` is paged (default 25 rows, at most 100). Other lists return at most 200 rows.
8. **Statuses** (\`CONFIRMED\`, \`CHECKED_IN\`, \`CHECKED_OUT\`, \`CANCELLED\`; \`UNPAID\`, \`PARTIAL\`, \`PAID\`) come from the functional requirements; the SRS does not list them.
9. **The web app's wording differs:** its Staff screen says managers can manage managers, and offers status "Pending Approval". This server follows the SRS reading in item 3 (a Manager manages Front Desk accounts only) and has no pending state; both are refused with a clear message. A changed email address is also refused for now.
10. **Room types need approval before they are sold** (S067): a new room type is submitted with its rates, stays PENDING, and one approval makes the type and its pending rates live. Front Desk sees approved types only. A change to the details of an approved room type (name, category, guests, description, facilities, photos) also waits for approval (migration 010): the approved details stay in force and the waiting values are in \`pending_changes\`; Administrator, or a Manager who may approve rates, decides it in the inbox (kind ROOM_TYPE); a name that another room type has taken meanwhile is refused at approval. The SRS only names Pending and Approved. A manager can still say no (M17, item 26): rejecting takes the pending item away and keeps a copy with the reason.
11. **Rate validation** (S063 to S065): a rate is more than 0, at most 9,999,999.99, with up to 2 decimals, in the property currency (a different \`currency_code\` is refused). A Date Range covers at most 366 days; \`selected_days\` lists each day once; \`priority\` is 0 to 100.
12. **Rate ties** (S066): precedence is item 5. When a new rule has the same type and priority as an approved rule on an overlapping night, the response carries a \`PRIORITY_TIE\` warning, and the preview lists tied nights. The rule is still created.
13. **Add-ons** (S069) are not an SRS entity; they are modelled as their own list with their own approval, separate from room types. A new price on an approved add-on waits as \`pending_unit_price\`. A charge from an add-on stores the price of that moment. Quantity defaults to 1 per stay, the number of nights per night, or the number of guests per guest.
14. **Rooms** (S062): room numbers are unique across the system, ignoring upper/lower case (the system serves one property). Floor is -5 to 200. A room's type cannot change while the room is assigned to a confirmed or in-house reservation, and a room that has been used for a stay cannot be deleted. Adding a room does not change room stock.
15. **Holds** (S080): a hold keeps one room of a type for a stay for 15 minutes by default (1 to 60 allowed) and counts in \`room_stock.reserved_rooms\` like a booking. A hold that ran out of time is given back the next time anyone searches availability or touches holds; the server does not need a timer. Confirming an expired hold returns \`HOLD_EXPIRED\`.
16. **Changing a CONFIRMED reservation** (S083): the new stay is priced again with the rates approved today (so the total can change), old ROOM charges are replaced and add-on and additional charges stay. Changing the room type clears the assigned room. After check-in only a later check-out and guest details can change; shortening a stay is done by checking out early.
17. **Cancel and No-Show** (S084, S085): only a CONFIRMED reservation can be cancelled or marked No-Show. The SRS gives no cancellation fee, deadline or refund rule, so none is applied; payments already taken are left as they are for staff to handle. A No-Show cannot be recorded before the arrival date. Nights before today are never returned to stock.
18. **Check-in** (S086) is refused before the arrival date and on or after the check-out date. **Check-out** (S087) needs a zero balance and returns the unused nights to stock when the guest leaves early.
19. **Charges are never edited or deleted** (S097): the database refuses it. A mistake is voided with a reason and stays visible under \`voided_charges\`. Editing the dates or room type of a CONFIRMED reservation voids its old room nights and records new ones. Room nights cannot be voided on their own; use a discount to waive a night.
20. **Tax and discounts** (S099): the SRS has neither. One tax rate per property (\`PATCH /api/settings\`) is copied onto each folio when it is created and applies to everything on the folio, after discounts. The default is 0, so nothing changes until a rate is set. A discount (percentage or fixed) is limited to Administrator and Manager and its amount is recorded when it is given. \`balance\` = total (charges minus discounts plus tax) minus payments received plus refunds paid out. \`total_charges\` now means that total.
21. **Payments and deposits** (S100): a deposit is a payment taken before or during the stay; both count towards the balance and neither can be more than the balance. An ONLINE payment needs a gateway reference. Without an Idempotency-Key or a gateway reference, two identical payments sent twice are recorded twice.
22. **Refunds** (S101): anyone who handles folios can request a refund of a completed payment; Administrator or Manager approves or rejects it, and not the person who asked. Only an approved refund changes the balance. The SRS has no refund rules, so there is no time limit and no refund to a different method.
23. **Housekeeping and maintenance** (S103, S104): check-out sets the room to the property's post-stay status (CLEANING unless changed) and creates a cleaning task; finishing the task makes the room AVAILABLE. A blocked room is released to CLEANING (not AVAILABLE) with an inspection task. Blocking a room does not change room stock; a Manager adjusts stock separately. Confirmed reservations that have the blocked room assigned are listed in the answer but are not moved.
24. **Notifications** (S105): in-app messages are stored as DELIVERED. E-mail is only logged as QUEUED because no mail service is connected (the SRS names none). The events are refund requested and decided, maintenance reported and room ready.
25. **Reports** (S106): occupancy and room revenue count CONFIRMED, CHECKED_IN and CHECKED_OUT reservations. Front Desk (operational reports) sees occupancy, room status and counts, but not payment totals. Days are in UTC+8.
26. **Approval inbox** (M17, S133 to S138): one API over room types (with their rates), rate rules and add-ons that wait for approval. Only an Administrator, or a Manager who was given the right to approve rates, may use it; Front Desk never. **Reject** takes the pending item away (a new room type, rate or add-on is deleted; a pending add-on price is cleared) and keeps a copy in the decision history with the reason, the person and the time. The desktop endpoints approve through the same code. The client sends the \`revision\` it saw; if the request changed, the answer is STALE_REQUEST. A request already decided is refused (INVALID_STATE) and the answer names who decided. The SRS has no manager mobile app: the API is written so any app can use it.
27. **Public booking engine** (M21, S166 to S172): no sign-in. A booking attempt takes a hold of \`hold_minutes\` (which is also the time to pay) and gets a private token (stored as a hash). The server prices the stay and the tax; any price sent by the client is refused. At most 3 unpaid attempts per e-mail address and 20 attempts a minute per IP address (the client has not set such limits).
28. **Payment gateway** (S170, S171): the client has not named a gateway. The webhook format (event id, type, reference, amount, currency) and the signature (HMAC-SHA256 of the raw body, header X-Signature, secret in env PAYMENT_WEBHOOK_SECRET) are assumptions and must be mapped to the real gateway. Each event is processed once. The amount, the currency and the reference must match the session the server created. The amount due online is \`online_deposit_pct\` of the total (default 100%).
29. **Late and failed payments** (S173, S179, S180): a failed payment releases the hold at once. A hold that ends unpaid is expired by a timer (every 30 seconds, env HOLD_SWEEP_SECONDS) and also whenever somebody searches. A payment that arrives after that still counts: if the room is free it is booked, otherwise the booking becomes PAID_UNFULFILLED and the managers are told to refund it at the gateway. The system does not call the gateway to refund.
30. **Confirmation e-mail** (S174): queued in a table (email_outbox), once per reservation. Nothing sends it: no mail service is part of the system.
31. **Cancellation and refund** (S175): free until \`free_cancellation_hours\` (default 48) before the check-in time; after that a fee of \`late_cancel_fee_pct\` (default 100) percent of the total. What the guest paid beyond the fee is asked back as refund requests that a Manager or Administrator must approve (M13). Staff and guests use the same rule. The folio is not changed by the fee: it is kept on the reservation (cancel_fee). Both are assumptions until the client decides.

## 10. Change log

| Version | Change |
|---|---|
| 0.2 | First contract: conventions, identifiers, error catalog, 25 implemented endpoints, 11 planned. |
| 0.3 | S056 and S058 built: the 11 planned endpoints (sessions, password rules and change, staff accounts) are now implemented. No field removed or renamed. |
| 0.4 | Added the web app endpoints (section 4a) and \`phone\` on staff accounts (migration 003). Nothing removed or renamed. |
| 0.5 | M09 (S060 to S069): room categories, room type details and approval, rooms with floors, rate validation, rate changes that wait for approval, price preview, add-ons (migration 004). New fields on existing responses: \`RoomType\` (category_id, photos, approval_status), \`Room\` (floor, room_type_id), \`Rate\` (room_type_id, currency_code, supersedes_id, effective_from, valid_until, in_force), \`RateCreated.warnings\`, charge type \`ADD_ON\`. Nothing removed or renamed. |
| 0.6 | M11 (S079 to S087): holds (\`/api/holds\`), reservation search with filters, sorting and paging, edits of dates, room type and guests, extensions, No-Show (\`POST /api/reservations/{id}/no-show\`), status NO_SHOW, error code \`HOLD_EXPIRED\`, check-in precondition on the arrival date, optional \`room_id\` on check-in (migration 005). New fields: \`AvailabilityItem.rooms_total\`, \`ReservationRow\` (phone, created_at), \`ReservationDetail\` (status_remark, status_changed_at, checked_in_at, checked_out_at). Check-in before the arrival date used to work and is now refused. |
| 0.7 | M13 (S097 to S106): folio detail, voiding, discounts and tax, payments and deposits with duplicate protection, refunds, invoice and receipt data, reconciliation, housekeeping, maintenance, settings, notifications, reports (migration 006, 35 endpoints). New fields on \`ReservationDetail\`: voided_charges, discounts, refunds, subtotal, discount_total, tax_rate_pct, tax_total, total_refunded; on \`Charge\`: stay_date, voided_at, void_reason; on \`Payment\`: kind, receipt_no. \`total_charges\` now includes discounts and tax (identical until a tax rate or discount is used). New role permissions: billing.discount, billing.refund, settings.manage, maintenance.release. Nothing removed or renamed. |
| 0.8 | M17 and M21 (S133 to S138, S166 to S175): approval inbox (\`/api/approvals\`, reject with reason, revision check), public booking engine (\`/api/public/...\`: availability, booking attempt, payment session, signed payment webhook, guest cancel), confirmation e-mail queue, cancellation rule with refund requests (migration 007, 12 endpoints). New settings: online_deposit_pct, free_cancellation_hours, late_cancel_fee_pct. New error codes: STALE_REQUEST, INVALID_SIGNATURE, PAYMENT_MISMATCH, PRICE_CHANGED, RATE_LIMITED. Cancelling a CONFIRMED reservation now creates refund requests for what was paid (after the fee). Nothing removed or renamed. |
| 0.9 | Staff web app server mode and guest accounts (migrations 008 and 009): \`GET /api/frontdesk/state\`, guest profiles (\`/api/guests\`), property name, logo and contact in \`/api/settings\`, room moves for guests already in the house, guest accounts for the booking website (\`/api/public/account/...\`). Nothing removed or renamed. |
| 0.10 | Room type changes need approval (migration 010): \`PATCH /api/room-types/{id}\` on an approved room type now stores the change as waiting (\`pending_changes\` on \`RoomType\`, \`pending_at\`) instead of applying it; it is decided in the approval inbox (kind ROOM_TYPE, \`details.is_change\`). Before, details changed at once. No endpoint removed or renamed. |
| 0.11 | Cleaning records (migration 011): a cleaning task has \`priority\` (NORMAL or HIGH), \`done_by_name\` and \`completion_note\`; new \`GET /api/housekeeping/rooms/{roomId}/history\` lists the finished cleans of a room; new \`PATCH /api/housekeeping/tasks/{id}\` changes notes or priority of an open task; \`complete\` takes an optional \`note\`; the task list filters by \`priority\`. The front desk state adds \`priority\`, \`lastCleanedAt\` and \`lastCleanedBy\` to each cleaning entry. No endpoint removed or renamed. |
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
