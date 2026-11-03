# AI service (front desk assistant)

A small Node service behind the assistant popup in `apps/fds-web`. It reads a staff message, works out what is being asked
(with an LLM, or with built-in rules), checks the result, and replies with **fixed text** in English, Malay or Mandarin.

**Read-only.** It never books, changes, cancels or touches payments or rates. The LLM only turns the message into a structured request;
anything it returns that is not exactly the expected shape is dropped. The model never writes SQL and never writes the reply.

## How read-only is guaranteed (room and booking data)

The assistant reads PostgreSQL with its own database user, `fds_ai_readonly`. **PostgreSQL itself refuses every write from that user**, so the assistant
cannot change data even if its code, its prompt or the model misbehaves:

1. **The database user has no write rights.** No INSERT, UPDATE, DELETE, TRUNCATE, no creating or dropping anything, no granting rights. It can only `SELECT` the
   columns listed in `db/create_readonly_role.sql`. It cannot read password hashes, login sessions, payments, folios, the audit log, or guests' phone numbers, emails or passport numbers.
2. Every connection starts read-only, and every query runs in a `BEGIN READ ONLY` transaction.
3. The code accepts only a single `SELECT` and rejects write keywords (a third layer; layers 1 and 2 do not depend on it).
4. **Fail closed.** At startup and every minute the service asks PostgreSQL what its user is allowed to do. If it finds *any* write right (for example someone put the `postgres`
   or API user in `AI_DATABASE_URL`), it **stops reading data** and logs `DATABASE BLOCKED`.
5. `npm run verify-readonly` tries 18 writes and forbidden reads as that user and checks that each one is refused.

What this does not cover: the team's API and its own database user can still write (that is how bookings are made). The guarantee is about the assistant's connection only.

Who is asking? The browser's FDS session cookie is sent here and the service asks the team's API (`GET /api/me`) who it belongs to. All data queries are limited to that
user's property. Without a valid API sign-in (for example the old demo login) the assistant only says what it understood, and reads no data.

## Run it

Requires Node.js 22 or newer. In `apps\ai-service`:

```
npm install
copy .env.example .env
```

**Without data (works anywhere):** edit `.env`, set `LLM_PROVIDER=openai` and paste your key after `OPENAI_API_KEY=` (in `.env` only, never in chat or git), or leave `LLM_PROVIDER=rules` (English only). Then `npm start`.

**With data (read-only):** needs a **real PostgreSQL server**. The API's built-in database cannot be opened by a second program.
1. Run the team's API against PostgreSQL (`apps/api/README.md`: `DATABASE_URL`, `npm run migrate`, `npm run seed`, port 3001).
2. Create the read-only user once, as a PostgreSQL superuser (choose your own long password; letters and digits are safest):
   ```
   psql -U postgres -d fds -v ai_password="CHOOSE_A_LONG_PASSWORD" -f db/create_readonly_role.sql
   ```
   (`psql` is in PostgreSQL's `bin` folder, for example `C:\Program Files\PostgreSQL\16\bin\psql.exe`.) Run it again after the team adds tables or columns the assistant should see.
3. In `.env` set `AI_DATABASE_URL=postgres://fds_ai_readonly:CHOOSE_A_LONG_PASSWORD@localhost:5432/fds`
4. `npm run verify-readonly` should print 18 lines starting with `PASS`.
5. `npm start` should print `database: read-only verified`.
6. Run the FDS with the API: `VITE_DEMO_AUTH=false` in `apps/fds-web/.env.local`, restart `npm run dev`, sign in with an API account (for example `frontdesk@fds.test`).

The FDS dev server forwards `/api/ai` here (port 3002) and everything else to the API. Restart this service after changing `.env`.

## What it can answer from the database

Room availability and rates for dates (rooms left, average nightly rate, total), room capacity, today's arrivals and departures, unpaid bookings, booking lookup by reference or guest name,
and whether a booking can be cancelled (it only reports; staff cancel). Not yet: who is in a room, stay extensions. The 72-hour hold does not exist in the database yet.

## Files

| File | What it does |
| --- | --- |
| `db/create_readonly_role.sql` | Creates the read-only database user and grants it only what it needs |
| `src/db.js` | The only database access: read-only connection and query wrapper |
| `src/guard.js`, `src/dbstate.js` | Asks PostgreSQL what the user may do; switches data off if it could write |
| `src/verify.js`, `scripts/verify-readonly.js` | `npm run verify-readonly` |
| `src/facts.js`, `src/pricing.js` | The fixed read-only queries and the nightly price rules (mirrors `apps/api/service.js`) |
| `src/identity.js` | Asks the API who is signed in (GET /api/me) |
| `src/chat.js` | The pipeline: understand, pick language, validate, reply |
| `src/llm/`, `src/rules.js` | Model prompt and checker, providers (OpenAI, local), built-in English parser used as fallback |
| `src/messages.js` | All fixed wording in three languages, date formats |
| `test/` | `npm test`. The database tests run when `TEST_ADMIN_URL` is set (a PostgreSQL superuser URL for a database with the team's migrations and seed) |

## Honest status

- Verified on PostgreSQL 16 (Linux) with the team's migrations and seed: the 18 refused attempts, answers matching the API's own `availability()` on six date ranges, no table changed by any query, fail-closed behaviour, property scoping.
  **Not yet verified on Windows or on your PostgreSQL version.**
- The nightly price rules are copied from `apps/api/service.js`. If the team changes their rules, run the database tests: they compare against the team's code.
- The Malay and Mandarin wording was drafted by AI and **needs a native reader**.
- The FDS screens still keep bookings in the browser. Until they use the API, the assistant answers from the database, which can differ from what the screens show.
- Only the staff message and the room type names go to OpenAI. Database contents (guest names, bookings) are never sent to the model; they appear only in the fixed-text replies and in the chat log in the browser, which is cleared on sign-out.
- The rules parser is English only and rolls a past date (such as "1 Oct") into next year.
