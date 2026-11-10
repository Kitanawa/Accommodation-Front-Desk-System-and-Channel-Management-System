# Backend changes (Chester): what this upload adds to `apps/api`

Only the backend. Nothing in `apps/fds-web`, `apps/booking-web` or `apps/manager-mobile` is part of this upload.

## Run
```
cd apps\api
npm install
npm run migrate
npm run seed:fds
set PORT=3001
npm start
```
- Built-in database, or `set DATABASE_URL=postgres://...` first for PostgreSQL.
- `seed:fds` loads the demo data with tax 16% (SST 6% + service 10%, the standard the staff web app uses). `npm run seed` keeps 0% (the automated tests need that).
- Run `migrate` and `seed:fds` before the first `npm start`. If `npm start` ran first, delete the folder `apps\api\data` and repeat.
- Demo sign-in: `admin@fds.test` / `Orchid-Demo-2026`. Tests: `npm test` (927 checks).

## New or changed since the main you have
- **Reservations, billing and operations, approvals and rules, guest booking engine** (`reservations.js`, `billing.js`, `operations.js`, `approvals.js`, `cancellation.js`, `public.js`). Migrations 005 to 007.
- **`GET /api/frontdesk/state`** (`frontdesk.js`): settings, rooms, reservations with charges and payments, housekeeping and guest profiles in one read, for the staff web app.
- **Guest profiles** (`guests.js`): `GET/POST /api/guests`, `PATCH/DELETE /api/guests/{id}`. Delete hides the profile; reservations keep their guest details. Guests now belong to a property.
- **Settings** (`PATCH /api/settings`): new fields `property_name`, `address`, `contact_email`, `contact_phone`, `logo_data_url` (PNG, JPG or WebP data URL under 2 MB).
- **Migration 008** adds guests.property_id / language / requests / deleted_at and property_settings.contact_email / contact_phone / logo_data_url.
- **Room move for a guest in the house** (`POST /api/reservations/{id}/assign-room`): the new room must be ready now and becomes Occupied; the room they leave goes to cleaning.
- **Seed**: `npm run seed:fds` (tax 16%).
- **Contract**: `docs/contract.js`, `API_CONTRACT.md` and `openapi.yaml` are regenerated with `npm run docs` and checked against the server by a test.

## Known limits and assumptions
- One room per reservation (a booking for several rooms has to be several reservations).
- One tax rate per property. At 16% the amounts can differ by 1 sen from a client that rounds SST and service charge separately.
- Only Administrator and Manager can submit price changes (`rates.manage`). An approved rate rule cannot be deleted, only revised.
- Add-on endpoints exist (`/api/add-ons`, approval needed); the staff web app has no screen for them.
- Not stored: planner stop-sell dates, inventory blocks by date, room notes.
- No payment gateway chosen (the webhook format is an assumption); e-mail is only queued.
- Hold length, cancellation fees, early check-in and refund approval use assumptions listed in the API contract that need confirming.

## Verified / not verified
- 927 automated checks pass on the built-in PostgreSQL engine (Linux), and the same 927 checks (all 15 files, including the new guest, settings and room-move parts) also pass on a real PostgreSQL 16.15 server.
- Not reviewed by a teammate. Not tested on Windows.
