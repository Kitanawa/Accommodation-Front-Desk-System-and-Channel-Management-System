# Evidence for S079 to S087 (M11: Reservations and inventory APIs)

Paste each work note into column P of the Subtask sheet. Do not set Progress to 100% or enter a Completed date until the reviews below have happened. Estimated and logged hours are yours to fill in. Nothing here has been reviewed by a teammate, and no front-end screen uses these endpoints yet.

Automated checks: `npm test` runs 632 checks in 12 files, all passing. M11 is `test/12_m11_reservations.js` (109 checks), plus `test/01_migrations.js` (migration 005 up and down) and updates to `test/03_contract.js`. The whole suite also passed on a real PostgreSQL 16.15 test server with `npm run test:pg`, including the "three bookings at once for two rooms" and "two check-ins into one room at once" checks. Source of all rules: SRS Draft 2 only; every rule the SRS leaves open is listed in `docs/API_CONTRACT.md` section 9 (items 15 to 18). Needs migration 005 (`npm run migrate`).

## S079 Availability query using stay dates and room type
> `GET /api/availability?from&to[&guests][&room_type_id]` (`check_in` and `check_out` are accepted as the same names). Per approved room type: rooms left and total, nightly rates, stay total, whether it is bookable and the reasons if not. Dates must not be in the past, check-out after check-in, at most 90 nights; guests 1 to 20. Holds that ran out of time are given back first; live holds count as taken. Another property's room type is not visible. Checks: `test/12` (8).

## S080 Inventory holds and transaction-safe booking confirmation
> `POST /api/holds` keeps one room for a stay for 15 minutes (1 to 60 allowed) and takes stock at once. `GET /api/holds/{id}`, `DELETE /api/holds/{id}` (release), `POST /api/holds/{id}/confirm` (turns the hold into a reservation in one transaction without taking a second room). A hold that ran out of time returns its room the next time anyone searches or touches holds, exactly once; confirming it returns `HOLD_EXPIRED`. Stock rows are locked in date order, so two people cannot take the last room. Needs migration 005 (`reservation_holds`). Checks: `test/12` (26).

## S081 Walk-in and phone reservation creation
> `POST /api/reservations` accepts any booking source 1 to 6 (1 Walk-in, 2 Phone). New or existing guest; room type, guest count, minimum nights and approved rate are checked; folio and one ROOM charge per night are created in the same transaction as the stock change. Three simultaneous bookings for two rooms give two 201 and one `SOLD_OUT`. Checks: `test/12` (7).

## S082 Booking search, filters, sorting and pagination
> `GET /api/reservations` with `q` (reference, guest name, phone, email, room number; `%` and `_` are plain text), `status` (including `NO_SHOW`), `payment_status`, `source_id`, `room_type_id`, `check_in_from/to`, `check_out_from/to`, `sort` (check_in, check_out, created_at, guest, reference, total), `order`, `page`, `page_size` (1 to 100, default 25). The body stays an array; paging is in the headers `X-Total-Count`, `X-Page`, `X-Page-Size`, `X-Total-Pages`. Every wrong parameter is reported at once. Checks: `test/12` (13).

## S083 Booking edits, room changes and stay extensions
> `PATCH /api/reservations/{id}`: guest details and notes (any time before check-out); dates, room type and guest count of a CONFIRMED reservation (old nights go back, new nights are taken, room charges are priced again with today's approved rates, add-on charges stay, an assigned room is cleared when the type changes); after check-in only a later check-out is allowed, and only the new nights are priced. A change that fails (sold out, no rate, room promised to someone else) leaves dates, charges and stock exactly as they were. Checks: `test/12` (17).

## S084 Cancellation rules and inventory release
> `POST /api/reservations/{id}/cancel` (optional `remark`, at most 300 characters). Only CONFIRMED can be cancelled. Nights from today on return to stock once, nights in the past never do, and the assigned room is freed. Audited. The SRS gives no cancellation fee, deadline or refund rule, so none is applied. Checks: `test/12` (9).

## S085 No-Show action with mandatory remark and audit
> `POST /api/reservations/{id}/no-show` with a required `remark` (not blank, at most 300 characters). Only CONFIRMED, and only on or after the arrival date. Status `NO_SHOW` (migration 005), stock returned, the remark stored on the reservation and in the audit record. A No-Show cannot be repeated, checked in or edited. Checks: `test/12` (9).

## S086 Check-in preconditions and room assignment
> `POST /api/reservations/{id}/check-in` (optional `room_id`). Needs a CONFIRMED reservation, on or after the arrival date and before the check-out date, and a room of the booked type that is Available and not used by another stay. Uses the given room, else the assigned room, else the first ready one. The room row is locked, so two check-ins into the same room cannot both succeed. Records the check-in time. **Behaviour change:** check-in before the arrival date used to be accepted and is now refused. Checks: `test/12` (9) and `test/03`.

## S087 Check-out occupancy update and dirty-room transition
> `POST /api/reservations/{id}/check-out`. Needs CHECKED_IN and a zero balance. The room becomes CLEANING (dirty), the folio closes, the check-out time is recorded, and when the guest leaves before the booked date the unused nights go back to stock. A dirty room cannot be checked into until it is cleaned. Checks: `test/12` (9).

## Whole-system check
> `test/12` ends by comparing, for every room type and every night from today, the stock counter with the number of live reservations and live holds: they match. This also covers the seeded demo reservations.

## What is not done or not verified
1. Nothing here has been reviewed by a teammate; no hours are logged.
2. Tested on the built-in engine and on one real PostgreSQL 16.15 server, not on the team's own database setup (Ivan's S059 check is still open).
3. The FDS web app does not call these endpoints yet; only sign-in and Staff are connected.
4. The two-things-at-once checks run on real PostgreSQL; on the built-in engine they pass because it runs one statement at a time, so they prove the logic, not the locking.
5. The expiry of holds is lazy (done when someone searches or touches holds), not by a timer. An unused hold therefore shows as ACTIVE in the database until the next search.

## Questions for the team
1. Eric: how long should a hold last (now 15 minutes by default, 60 at most)?
2. Eric: are there cancellation fees, deadlines or refund rules? None are applied today.
3. Eric: may a guest check in early (before the arrival date) if a room is ready? It is refused today.
4. Eric / Qiwei: when dates or room type change on a CONFIRMED reservation, the price is calculated again with today's rates. Should it keep the old price instead?
