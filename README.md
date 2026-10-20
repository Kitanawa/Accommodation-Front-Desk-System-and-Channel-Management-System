# FDS Backend (M08: S052 to S058)

Accommodation Front Desk System backend, built from SRS Draft 2. Node.js, Express, PostgreSQL.

| Subtask | Where |
|---|---|
| **S052, S053** ERD and approval/pricing/audit tables | `erd/` (Mermaid, PNG, data dictionary, review workbook, SQL) |
| **S054** Migrations and anonymous seed fixtures | `migrations/`, `migrate.js`, `cli.js`, `seed.js`. Guide: `docs/S054_MIGRATIONS_AND_FIXTURES.md` |
| **S055** API contracts, identifiers, response errors | `docs/API_CONTRACT.md` (read this), `docs/openapi.yaml` (for tools), `errors.js` (error catalog) |
| **S056** Authentication, hashing, session revocation | `auth.js`, `password.js`, `/api/login`, `/api/sessions` |
| **S057** Role and property checks | `permissions.js`, tests `08`, `06` |
| **S058** Staff accounts and password validation | `/api/users`, `/api/me/password`, `/api/password-policy` |

## Run it (Node 18 or newer)

```
npm install
npm start          # http://localhost:3000. Creates and fills the database on first start.
npm test           # 6 test files, 149 checks
```
With no setup it uses an embedded PostgreSQL engine and keeps data in `data/`. To use your own PostgreSQL server: `DATABASE_URL=postgres://user:password@localhost:5432/fds npm start`.

Demo accounts (anonymous fixtures):

| Role | Email | Password |
|---|---|---|
| Administrator | admin@fds.test | Orchid-Demo-2026 |
| Owner / Manager | manager@fds.test | Lantern-Demo-2026 |
| Front Desk | frontdesk@fds.test | Meadow-Demo-2026 |

## What runs today

All the reservation work (availability, create, edit, cancel, assign room, check-in, check-out, folio, payments, rooms, rates, approval, audit, dashboard) follows the contract: UUID ids, one error shape with codes, `X-Request-Id`, role checks from the SRS matrix, and every query limited to the caller's property.

Because the contract describes sign-in, the supporting parts of S056 are already in: database-backed sessions, expiry, idle timeout, logout revocation, lockout after 5 wrong passwords, scrypt hashing.

**Still to build** (defined in the contract, marked S056 / S058): the endpoints to list and revoke sessions, and everything for staff accounts and passwords (create, edit, reset, change, password rules).

## Files

```
migrations/    001_init, 002_auth (up and down SQL)
migrate.js     migration runner      cli.js   migrate / rollback / status / seed / reset
seed.js        anonymous fixtures
server.js      the API               auth.js  sign-in and sessions     permissions.js  SRS role matrix
service.js     pricing, availability, reservations     password.js   hashing and password rules     errors.js   error catalog
docs/          API_CONTRACT.md, openapi.yaml, contract.js (their single source), build.js, S054 guide, evidence note
test/          01 migrations, 02 fixtures, 03 contract, 04 business flows, 05 contract drift, 06 property scope
```

Regenerate the contract files after changing `docs/contract.js`: `npm run docs`. Test 05 fails if they are out of date.
