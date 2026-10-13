# Front Desk AI Assistant: prototype slice

Staff type a request ("Find me a single room from 25th to 30th November"). The assistant checks the
database, answers from the data only, and **opens the room planner with the matching dates highlighted**.
It cannot create, change or cancel bookings and cannot handle money. FAKE DATA ONLY.

It understands and replies in **English, Malay or Mandarin** (see "Languages").

Stack: React (Vite) + Node.js (Express) + MySQL.

## Run it (about 10 minutes)

1. **MySQL.** Use a local MySQL 8 (or XAMPP). Load the fake data, in this order:
   ```
   mysql -u root -p < db/schema.sql
   mysql -u root -p < db/seed.sql
   ```
   (`schema.sql` creates its own database called `frontdesk_ai`; it does not touch other databases.)

   Optional larger test data (40 rooms, 8 room types, 300 guests, 10 agents, 1,155 bookings):
   load `db/seed_large.sql` the same way and set `DB_NAME=frontdesk_ai_large` in `.env`.
   Check the top of that file: if it does not create the `frontdesk_ai_large` database itself, create it first.
2. **Backend.**
   ```
   cd backend
   npm install
   copy .env.example .env      (Windows)     or     cp .env.example .env
   ```
   Open `.env` and set `DB_PASSWORD` (and `DB_PORT` if your MySQL is not on 3306).
   Never commit `.env`: it holds your password and API keys. The repo's `.gitignore` already excludes it.
3. **Front end.**
   ```
   cd ../frontend
   npm install
   npm run build
   ```
4. **Start.**
   ```
   cd ../backend
   npm start
   ```
   Open http://localhost:3001

Developing the front end with hot reload: run `npm start` in backend, and `npm run dev` in frontend
(open http://localhost:5173).

## Try these

- Find me a single room from 25th to 30th November  (expect: 3 rooms left, RM110/night, RM550, Single row highlighted)
- Which rooms are free from 25 Nov to 30 Nov?
- Find me a room for 2 between 21st to 24th Oct
- Which blocked bookings are within 72 hours?   /   Which bookings are unpaid?
- Can BK-0003 extend until 30 Oct?
- Give this guest a discount  (it must refuse)
- Malay and Mandarin (need `LLM_PROVIDER=openai`): "Ada bilik single kosong dari 5 Nov hingga 10 Nov?" /
  "11月5日到11月10日有单人房吗？"

Deep link (how the dashboard can open already highlighted):
`http://localhost:3001/?type=Single&from=2026-11-25&to=2026-11-30`

## Test

```
cd backend
npm test                 # 30 questions on the small seed
npm run test:large       # 200 questions on the large seed (set DB_NAME=frontdesk_ai_large)
```
`npm test` runs `backend/test/cases.json` through the real pipeline and prints a score. The answer keys for the
large set come from independent SQL. These tests run the rules parser unless `LLM_PROVIDER` is set.

## How it works

1. **Understand** (`parse.js` rules, or an LLM from `src/llm/`): message -> structured request (intent, room type, dates, language...).
2. **Validate**: room type exists, dates make sense, language is one of the three supported.
3. **Tools** (`inventory.js`): fixed read-only database queries. The model never writes SQL.
4. **Reply built by code from the results** (`chat.js`, templates in `i18n.js`), so it cannot contain an invented price or date.
5. **Action**: a `highlight_planner` instruction the front end applies to the planner.
6. Every exchange is written to `ai_audit_log`.

## Languages

Only English (`en`), Malay (`ms`) and Mandarin (`zh`, Simplified) are supported.

- The model reports the language of the message. Chinese characters always count as Mandarin.
- If the message is in another language, the reply is in English with a short note that only the three are supported.
- All reply text is in fixed templates in `backend/src/i18n.js`. The model never writes reply text.
- Database content (room type names, booking IDs, guest names) is shown as stored, never translated.
- The Malay and Mandarin wording was drafted by AI and should be read by someone who knows the language.
- The rules parser (no API) still understands English only, but replies in the detected language.

## Using an LLM for understanding

Default is `LLM_PROVIDER=rules` (no key needed). This project uses OpenAI: set in `.env`
`LLM_PROVIDER=openai`, `OPENAI_API_KEY=...` and `OPENAI_MODEL=gpt-5.4-mini`.
Only the OpenAI adapter has been tried against a live API. The Gemini, Anthropic and local adapters in
`backend/src/llm/providers.js` are written but untested. If the API call fails, the app falls back to the rules parser.
Use fake data only. `npm run compare` runs the test questions on a model (see `backend/test/compare.config.json`).
If you change the prompt (`backend/src/llm/prompt.js`), bump `PROMPT_VERSION`.

## Assumptions to confirm with the client

- The 72-hour rule counts from 00:00 on the check-in date.
- Rooms under maintenance are not sellable.
- A night is "booked" when a blocked, confirmed or checked-in booking covers it.
- "Today" is pinned to 2026-10-04 (`APP_TODAY` in `.env`) because the fake data is Oct to Dec 2026.
- The IRBS manual's room planner shows price, booked (B) and available (A) per room type per day.
  This prototype copies that layout. Real data comes from the team's database, not these tables.

## Not done yet

Login/roles, multiple branches, rate approval, real booking tables, the highlight inside Eric's real
planner, conversation history, translated front-end text (the greeting is trilingual, the rest is English),
refusing every kind of "change the data" request (for example "Delete BK-..." and "mark as paid" are not yet refused),
and model comparison.
