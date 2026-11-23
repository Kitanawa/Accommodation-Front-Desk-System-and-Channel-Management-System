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
- Demo sign-in: `admin@fds.test` / `Orchid-Demo-2026`. Tests: `npm test` (1006 checks).

## New or changed since the main you have
- **Reservations, billing and operations, approvals and rules, guest booking engine** (`reservations.js`, `billing.js`, `operations.js`, `approvals.js`, `cancellation.js`, `public.js`). Migrations 005 to 007.
- **`GET /api/frontdesk/state`** (`frontdesk.js`): settings, rooms, reservations with charges and payments, housekeeping and guest profiles in one read, for the staff web app.
- **Guest profiles** (`guests.js`): `GET/POST /api/guests`, `PATCH/DELETE /api/guests/{id}`. Delete hides the profile; reservations keep their guest details. Guests now belong to a property.
- **Settings** (`PATCH /api/settings`): new fields `property_name`, `address`, `contact_email`, `contact_phone`, `logo_data_url` (PNG, JPG or WebP data URL under 2 MB).
- **Migration 008** adds guests.property_id / language / requests / deleted_at and property_settings.contact_email / contact_phone / logo_data_url.
- **Room move for a guest in the house** (`POST /api/reservations/{id}/assign-room`): the new room must be ready now and becomes Occupied; the room they leave goes to cleaning.
- **Seed**: `npm run seed:fds` (tax 16%).
- **Contract**: `docs/contract.js`, `API_CONTRACT.md` and `openapi.yaml` are regenerated with `npm run docs` and checked against the server by a test.

## Room type changes need approval (migration 010)
- **Room type changes wait for approval, like a rate change.** `PATCH /api/room-types/{id}` on an approved room type no longer changes it. The new name, category, guests, description, facilities or photos are stored as waiting values (`pending_changes`, `pending_at` on the room type; Administrator and Manager see them, Front Desk does not). The approved details stay in force until an Administrator, or a Manager who may approve rates, approves the request in the approval inbox (`GET /api/approvals?kind=ROOM_TYPE`, `details.is_change` is true, `details.current` and `details.changes` show before and after). Reject keeps the room type as it was and records the reason. Sending the current value again takes a waiting change back. A name that another room type took while the request waited is refused at approval. A room type that is still PENDING (new) changes at once, as before.
- **Staff web app:** `GET /api/frontdesk/state` keeps the approved name and details in `rooms[]` and adds `detailRequest` (`changes`, `status`, `submittedAt`) while a change waits. The web app should show the approved values and the waiting ones, and Approve and Reject go through `POST /api/approvals/ROOM_TYPE/{id}/approve` and `/reject`.

## Cleaning records (migration 011)
- A cleaning task now has a `priority` (`NORMAL` or `HIGH`, default `NORMAL`), `done_by_name` (who finished it) and `completion_note` (up to 300 characters). Open tasks with HIGH priority are listed first.
- `POST /api/housekeeping/tasks` accepts `priority`. New `PATCH /api/housekeeping/tasks/{id}` changes `notes` or `priority` of an open or in-progress task (finished or cancelled tasks answer INVALID_STATE). `POST /api/housekeeping/tasks/{id}/complete` accepts an optional `note`. `GET /api/housekeeping/tasks` can filter by `priority`; new `GET /api/housekeeping/rooms/{roomId}/history?limit=` (default 20, at most 100) returns the finished cleans of one room, newest first, with who finished each and the note.
- `GET /api/frontdesk/state`: each `cleaning[room]` entry gains `priority` (`Normal` or `High`), and `lastCleanedAt` and `lastCleanedBy` once the room has had a finished clean. This matches the Priority choice on the web Housekeeping screen, which the backend did not store before.
- Audit: `HOUSEKEEPING_UPDATED` (new); `HOUSEKEEPING_TASK_CREATED` now includes the priority.
- **Tests:** 1006 checks in 18 files pass on the built-in engine and on a real PostgreSQL 16.15 server (new: `17_room_type_change_approval.js`, `18_cleaning_records.js`; two date-dependent checks were fixed).

## Known limits and assumptions
- One room per reservation (a booking for several rooms has to be several reservations).
- One tax rate per property. At 16% the amounts can differ by 1 sen from a client that rounds SST and service charge separately.
- Only Administrator and Manager can submit price changes (`rates.manage`). An approved rate rule cannot be deleted, only revised.
- Add-on endpoints exist (`/api/add-ons`, approval needed); the staff web app has no screen for them.
- Not stored: planner stop-sell dates, inventory blocks by date, room notes.
- No payment gateway chosen (the webhook format is an assumption); e-mail is only queued.
- Hold length, cancellation fees, early check-in and refund approval use assumptions listed in the API contract that need confirming.

## Verified / not verified
- 1006 automated checks pass on the built-in PostgreSQL engine (Linux), and the same 1006 checks (all 18 files, including the new guest, settings and room-move parts) also pass on a real PostgreSQL 16.15 server.
- Not reviewed by a teammate. Not tested on Windows.
