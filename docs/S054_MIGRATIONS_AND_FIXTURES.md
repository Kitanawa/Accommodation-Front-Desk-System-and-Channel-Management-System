# S054: Database migrations and anonymous seed fixtures

## What is delivered

| Item | File |
|---|---|
| Migrations (up and down) | `migrations/001_init.*.sql`, `migrations/002_auth.*.sql` |
| Migration runner | `migrate.js` (used by the server and by `cli.js`) |
| Commands | `cli.js`, `npm run migrate`, `migrate:down`, `migrate:status`, `seed`, `db:reset` |
| Anonymous fixtures | `seed.js` |
| Tests | `test/01_migrations.js` (33 checks), `test/02_fixtures.js` (18 checks) |

## The migrations

| Version | What it does |
|---|---|
| `001_init` | Creates the 17 tables of the SRS entity list with every constraint and index designed in S052/S053, and loads the reference values: 3 roles, 4 room statuses, 6 booking sources. |
| `002_auth` | Adds what S056 and S058 need on top of the SRS entities: five columns on `users` (`is_active`, `failed_login_count`, `locked_until`, `password_changed_at`, `last_login_at`), a unique index on `lower(email)`, and the `user_sessions` table. |

**Note:** `002_auth` goes beyond the S052/S053 ERD (18 tables instead of 17). Either add `user_sessions` and the five `users` columns to the ERD and review workbook, or keep `002_auth` out until S056 starts. Nothing in S054/S055 depends on `001` being changed.

## How migrations behave

- Files are `NNN_name.up.sql` and `NNN_name.down.sql`, applied in number order.
- The applied versions are recorded in the table `schema_migrations`.
- Each migration runs in **one transaction**: if any statement fails, that migration leaves nothing behind and is not recorded. (Tested with a deliberately broken migration.)
- Running `migrate` again does nothing when everything is applied.
- `rollback` undoes the newest migration only (`rollback 2` the newest two, `rollback all` everything). **Rolling back drops tables and their data.** Do not run it on data you want to keep.
- The server runs `migrate` at start-up, so a fresh or older database is brought up to date by itself.

### Commands

| Command | Does |
|---|---|
| `npm run migrate` | Apply all pending migrations |
| `npm run migrate:status` | List each migration as applied `[x]` or pending `[ ]` |
| `npm run migrate:down` | Roll back the newest migration |
| `node cli.js rollback all` | Roll back everything |
| `npm run seed` | Load the fixtures (only if the database has no users) |
| `npm run db:reset` | Roll back everything, migrate, seed: a clean demo database |

### Adding a migration

1. Create `migrations/003_short_name.up.sql` and `003_short_name.down.sql` (next number; the down file must undo the up file exactly).
2. Never edit a migration that others have already applied; add a new one.
3. Run `npm run migrate`, then `npm run migrate:down`, then `npm run migrate` again to prove both directions work.
4. Add a check to `test/01_migrations.js` if the migration adds a rule.

## Anonymous seed fixtures

Everything is invented. No real person, hotel, email, phone number or ID number appears anywhere.

| Rule | How the fixtures follow it |
|---|---|
| Emails | Staff end in `@fds.test`, guests in `@example.test` (reserved test domains that can never be real) |
| Phone numbers | `+60 12-000 0000` |
| ID / passport numbers | `X0000001` to `X0000003` |
| Names | `Guest One`, `Guest Two`, `Guest Three`, `Administrator`, `Owner Manager`, `Front Desk Staff` |
| Property | `Harbour View Hotel (demo)`, `1 Example Road, Sample City` |
| Passwords | Stored only as scrypt hashes. The demo passwords below are published on purpose and are for the demo database only. |

| Fixture | Count | Notes |
|---|---|---|
| Property | 1 | Currency MYR |
| Users | 3 | One per role. Only the Administrator can approve rates at first (Manager approval is switched off). |
| Room categories / types / rooms | 3 / 3 / 12 | Standard Twin (6 rooms), Deluxe King (4), Family Suite (2, minimum 2 nights) |
| Stock | 369 rows | One per room type per night, from 2 days ago to 120 days ahead |
| Rate rules | 6 | 5 approved, 1 pending (Family Suite on 2026-12-31) so approval can be shown |
| Reservations | 3 | Guest One arrives today, Guest Two tomorrow, Guest Three in 5 days. 8 room charges, 8 room-nights reserved. |
| Optional second property | +1 property, 1 user, 2 rooms | `addSecondProperty()`, used to test that properties are separate |

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Administrator | admin@fds.test | Orchid-Demo-2026 |
| Owner / Manager | manager@fds.test | Lantern-Demo-2026 |
| Front Desk | frontdesk@fds.test | Meadow-Demo-2026 |

The demo passwords already meet the password rules planned for S058.

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | (empty) | PostgreSQL connection string. Empty means the embedded PostgreSQL engine, data in `./data`. |
| `PORT` | 3000 | HTTP port |
| `PGLITE_DIR` | `./data` | Folder for the embedded engine (`memory` = throw-away) |
| `SEED_ON_START` | true | Set `false` so the server never loads fixtures (use this on any database that holds real data) |
| `SESSION_TTL_HOURS` | 8 | Session lifetime |
| `SESSION_IDLE_MINUTES` | 60 | Idle limit |

For S059 (secret configuration): `DATABASE_URL` is the only secret so far. Keep it out of the repository.

## What the tests prove

- Up, down, up again, down all, up again all work, and `status` is correct at each step.
- A migration with an error rolls back completely.
- The migrated schema rejects: reserved rooms above total, a second approved Base Rate, a date range that ends before it starts, a Base Rate with a date, a Selected Day rule with no days, a rate status other than Pending/Approved, a reservation that checks out on its check-in date, an unknown reservation status, a second folio, a duplicate gateway reference, an email that differs only by capital letters, a duplicate room number, and deleting a room type that is in use.
- The fixtures have the counts above, cover the right date range, and load once only. A reset gives the same data.
- No email, phone, ID number or name falls outside the anonymous patterns, and no password is stored as text.
