# FDS Backend (M08, S052 to S058): How to Run

Needs Node.js 18 or newer. Commands are for Windows Command Prompt, run inside this folder.

## 1. Run with the built-in database (easiest)

```
npm install
npm test
npm start
```

- `npm test` should end with `TOTAL: 281 passed, 0 failed, 9 test files`.
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
- `npm run migrate` creates all 18 tables. You do not create tables by hand.
- Never commit a real password. Use `.env` (copy `.env.example`).

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
