# FDS Backend (M08 and M09, S052 to S069): How to Run

Needs Node.js 18 or newer. Commands are for Windows Command Prompt, run inside this folder.

## 1. Run with the built-in database (easiest)

```
npm install
npm test
npm start
```

- `npm test` should end with `TOTAL: 518 passed, 0 failed, 11 test files`.
- `npm start` runs the API at http://localhost:3000. Stop it with Ctrl+C.
- Data is kept in a `data/` folder. No database install needed.

## 2. Run with a real PostgreSQL server

1. Create an empty database called `fds`.
2. Run:

```
set DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/fds
npm run migrate
npm run seed
npm start
```

- Use your own PostgreSQL user and password, with no quotes.
- Special characters in the password must be encoded: `@` is `%40`, `#` is `%23`, `/` is `%2F`, `:` is `%3A`, `%` is `%25`.
- `npm run migrate` creates all 19 tables. You do not create tables by hand.
- Never commit a real password. Use `.env` (copy `.env.example`).

To run the whole test suite on a real PostgreSQL server, give it a connection string to any database on that server (the user must be allowed to create databases). Each test file gets its own new database, dropped afterwards:

```
set TEST_PG_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/postgres
npm run test:pg
```

## 3. Test the sign-in

With the server running, open a second Command Prompt window:

```
curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d "{\"email\":\"admin@fds.test\",\"password\":\"Orchid-Demo-2026\"}"
```

Demo accounts:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@fds.test | Orchid-Demo-2026 |
| Owner / Manager | manager@fds.test | Lantern-Demo-2026 |
| Front Desk | frontdesk@fds.test | Meadow-Demo-2026 |

To try every endpoint, import `docs\openapi.yaml` into Postman.

## 4. Connect the FDS web app (apps/fds-web)

The web app signs in through this API and uses it for the **Staff** screen. The other screens (reservations, rooms, pricing) still use demo data stored in the browser. They are not connected yet.

Put this folder at `apps\api` in the team repo. Then, in the repo root:

Window 1, the API (it must run on port 3001, where the web app forwards `/api`):
```
cd apps\api
npm install
set PORT=3001
npm start
```
(For a real PostgreSQL server, also run the `set DATABASE_URL=...`, `npm run migrate` and `npm run seed` lines from section 2 first.)

Window 2, the web app:
```
npm install
echo VITE_DEMO_AUTH=false> apps\fds-web\.env.local
npm run dev
```
Open http://127.0.0.1:5176 and sign in with `admin@fds.test` / `Orchid-Demo-2026` (the old demo login `admin@hotel.local` only works with `VITE_DEMO_AUTH=true`). Restart the web app after changing `.env.local`.

- The web app and the API must be reached through the same address (the dev server forwards `/api` for you), because the session is a cookie.
- If the API is on another port, set `API_PROXY_TARGET=http://127.0.0.1:PORT` before `npm run dev`.
- Tested with a real browser (headless Chromium): sign in, staff list, add, edit, disable, duplicate email, sign out.
- Details of the web app endpoints: `docs\API_CONTRACT.md`, section 4a.

### Check that the web app is really connected

1. Sign in with `admin@fds.test`. This account exists only in the API database, so it works only if the web app is using the API. The old demo login `admin@hotel.local` should fail.
2. Press F12, open the Network tab and sign in again. `POST /api/auth/login` should return 200, and the Staff screen should call `GET /api/staff`. Under Application, Cookies, `fds_session` should be marked HttpOnly.
3. Stop the API (Ctrl+C in window 1) and reload the web app. Sign-in and the Staff list should fail. Start the API again and they work again.
4. Add a staff member in the Staff screen, then read the list from the API in a third window:
```
curl -c c.txt -X POST http://127.0.0.1:3001/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@fds.test\",\"password\":\"Orchid-Demo-2026\"}"
curl -b c.txt http://127.0.0.1:3001/api/staff
```
The new person should appear in the JSON.
5. Sign in as `frontdesk@fds.test`. Staff management should be refused.

## Other commands

| Command | What it does |
|---|---|
| `npm run migrate:status` | Shows which migrations are applied |
| `npm run migrate:down` | Rolls back the latest migration |
| `npm run db:reset` | Wipes, migrates and seeds again (deletes data) |
| `npm run docs` | Rebuilds `docs\API_CONTRACT.md` and `docs\openapi.yaml` |

## Problems

- `password authentication failed`: wrong user or password in `DATABASE_URL`. The default user is `postgres`.
- `database "fds" does not exist`: create it first.
- `ACCOUNT_LOCKED`: five wrong passwords lock an account for 15 minutes. `npm run db:reset` clears it on a development database.
