# Evidence for S060 to S069 (M09: Rooms, rates and approval APIs)

Paste each work note into column P of the Subtask sheet. Do not set Progress to 100% or enter a Completed date until the reviews below have happened. Estimated and logged hours are yours to fill in. Nothing here has been reviewed by a teammate.

Automated checks: `npm test` runs 518 checks in 11 files, all passing. M09 is `test/11_m09_rooms_rates.js` (161 checks) and `test/01_migrations.js` (migration 004 up and down). The whole suite also passed on a real PostgreSQL 16.15 test server with `npm run test:pg`. Source of all rules: SRS Draft 2 only; every rule the SRS leaves open is listed in `docs/API_CONTRACT.md` section 9 (items 10 to 14).

## S060 Room category CRUD with duplicate checks
> `GET/POST /api/room-categories`, `PATCH/DELETE /api/room-categories/{id}`. Name 2 to 80 characters. Duplicate names refused ignoring upper/lower case and spaces (409 CONFLICT, field `name`), also enforced by a unique index. A category that still has room types cannot be deleted. Another property's category returns 404. Front Desk can view only. Checks: `test/11` (11) and `test/01`.

## S061 Room type details, facilities and photo metadata
> `GET/POST /api/room-types`, `GET/PATCH /api/room-types/{id}`. Name, category, max guests 1 to 20, min nights 1 to 365, description, layout, facilities (list of up to 40 names, repeats dropped), photos (up to 20, metadata only: url, caption, alt, order; url must be http(s) or start with /). Duplicate name in a category refused ignoring case. Details of an approved room type change at once. Checks: `test/11` (22).

## S062 Physical room CRUD, room numbers and floor assignment
> `POST /api/rooms`, `PATCH/DELETE /api/rooms/{id}`; `GET /api/rooms` now returns floor and room type id. Room number 1 to 10 letters, digits or hyphens, unique ignoring case. Floor -5 to 200 (migration 004). A room's type cannot change while it is assigned to a confirmed or in-house reservation; a room with stay history cannot be deleted. Checks: `test/11` (18).

## S063 Base Rate and currency validation
> `POST /api/rates` now needs a rate more than 0, at most 9,999,999.99, at most 2 decimals, in the property currency (a different or badly formed `currency_code` is refused). Priority 0 to 100. Responses show `currency_code`. Checks: `test/11` (15).

## S064 Date Range rule validation and matching
> A range must end on or after it starts and cover at most 366 days; impossible dates are refused; both end dates are included when matching. Checked through the price preview. Checks: `test/11` (5).

## S065 Selected Day and Specific Date rule matching
> Selected Day: days 0 (Sunday) to 6 (Saturday), each once, at least one. Specific Date: that night only. A weekday-only preview proves the Fri/Sat rule beats the Base Rate on those days only. Checks: `test/11` (7).

## S066 Agreed priority conflicts and nightly pricing preview
> `GET /api/rates/preview?room_type_id&from&to`: the winning rule per night, the rules that lost, nights that tie, nights with no rate (total null). Front Desk sees prices only. Creating a rule that ties with an approved rule (same type, same priority, overlapping night) returns a `PRIORITY_TIE` warning. The precedence itself is unchanged and still an assumption (FR-17 says "to be confirmed"): higher priority, then Specific Date > Date Range > Selected Day > Base. Pending: Eric confirms the rule. Checks: `test/11` (11).

## S067 Combined room type submission and approval state transitions
> `POST /api/room-types` submits a room type with its rates (exactly one Base Rate if rates are sent); everything starts PENDING. Pending room types are hidden from Front Desk, not offered in availability, and cannot be booked (409). `POST /api/room-types/{id}/approve` approves the type and its pending rates in one step (needs a pending Base Rate). `DELETE` withdraws a pending type that was never booked. Only Administrator, or a Manager with approval rights, may approve. Pending: the team confirms "new room types need approval", which the SRS implies for rates only. Checks: `test/11` (19).

## S068 Rate-change review preserving the current approved rate until effective
> `POST /api/rates/{id}/revise` creates a new PENDING rate that points at the one it replaces; the approved rate stays in force. On approval the old rate ends on the effective date (default: the approval day) and older waiting rates end with it. Existing reservations keep their recorded price. A pending change can be withdrawn with `DELETE /api/rates/{id}`; an approved rate cannot be deleted. Needs migration 004 (`supersedes_id`, `effective_from`, `valid_until`). Checks: `test/11` (19) and `test/01`.

## S069 Add-on CRUD, independent approval and recorded-price preservation
> `GET/POST /api/add-ons`, `PATCH/DELETE /api/add-ons/{id}`, `POST /api/add-ons/{id}/approve`. Approval is separate from room types. A new price on an approved add-on waits as `pending_unit_price`; the approved price stays until approved. `POST /api/reservations/{id}/charges` accepts `add_on_id`: the price is taken from the approved add-on and stored on the charge, so later price changes never alter it. Quantity defaults to 1 per stay, nights per night, guests per guest. Add-ons are not an SRS entity, so this is a design assumption. Checks: `test/11` (33) and `test/01`.

## Questions for the team
1. Eric: is the rate precedence (priority, then Specific Date > Date Range > Selected Day > Base) what the client wants?
2. Eric / Qiwei: should a new room type wait for approval before it can be sold? Should a pending item be withdrawn or "rejected"?
3. Eric: are add-ons something the client wants approved separately from room rates?
4. Qiwei: the web app has no screens yet for room categories, room types, rooms, rate changes or add-ons.
5. Ivan: run `npm run test:pg` on the team's PostgreSQL setup (S059).

## What is not done and is not claimed
- No teammate has reviewed anything. No hours are logged.
- No front end. All tests call the API directly.
- Room stock (how many rooms are sellable per night) is not part of M09; adding a room does not change it.
- Run on one real PostgreSQL 16.15 test server, not on the team's own database setup.
- The ERD and review workbook do not include `add_ons` or the new columns of migration 004.
