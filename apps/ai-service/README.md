# AI service (front desk assistant)

A small Node service behind the assistant popup in `apps/fds-web`. It reads a staff message, works out what is being asked
(with an LLM, or with built-in rules), checks the result, and replies with fixed text in English, Malay or Mandarin.

**Read-only.** It never books, changes, cancels or touches payments or rates. The LLM only turns the message into a
structured request; anything it returns that is not exactly the expected shape is dropped. Replies are fixed text, not model-written.

**Current step:** room, rate and booking data are **not connected yet**, so data questions only say what was understood.
Refusals (refunds, discounts, cancel, delete/move/mark as paid), the 72-hour-hold note and the help message already work.

## Run it

Requires Node.js 22 or newer. In `apps\ai-service`:

```
npm install
copy .env.example .env
```

Edit `.env`. For the OpenAI model set `LLM_PROVIDER=openai` and paste your key after `OPENAI_API_KEY=` (in `.env` only, never in chat or git).
Leave `LLM_PROVIDER=rules` to run without a key (English only).

```
npm start
```

It listens on http://127.0.0.1:3002. Check it: http://127.0.0.1:3002/api/ai/health
Then run the FDS as usual (`npm run dev` in the repository root). The FDS dev server forwards `/api/ai` here and everything else to the main API.
Restart this service after changing `.env`.

## Files

| File | What it does |
| --- | --- |
| `src/server.js` | `GET /api/ai/health`, `POST /api/ai/chat` (500 character limit) |
| `src/chat.js` | The pipeline: understand, pick language, validate, reply |
| `src/llm/` | Prompt and output checker (`prompt.js`), providers (`providers.js`: OpenAI and local), timeouts and retries (`http.js`) |
| `src/rules.js` | The built-in English parser, used in rules mode and as the fallback if the model call fails |
| `src/messages.js` | All fixed wording in three languages, date formats |
| `src/dates.js` | Date helpers; "today" uses the Kuching time zone |
| `test/` | `npm test` (uses a fake model server, no real key) |

## Honest status

- Tested with a fake OpenAI-compatible server and the rules parser. **Not yet tried against the real OpenAI API** from this folder.
- The Malay and Mandarin wording was drafted by AI and **needs a native reader** (refusals especially).
- The rules parser is English only. It does not handle month-first dates ("Nov 25 - Nov 30") or relative dates ("tomorrow").
- Booking references are read as `R-` plus 6 letters or digits (the API contract format). The FDS screens do not show that format yet.
- No login check yet: anyone who can reach port 3002 on this computer can call it. It listens on 127.0.0.1 only.
