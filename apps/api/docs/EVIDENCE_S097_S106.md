# Evidence for S097 to S106 (M13: Billing and operations APIs)

Paste each work note into column P of the Subtask sheet. Do not set Progress to 100% or enter a Completed date until the reviews below have happened. Estimated and logged hours are yours to fill in. Nothing here has been reviewed by a teammate.

Automated checks: `npm test` runs 760 checks in 13 files, all passing, on the built-in engine and on one real PostgreSQL 16 server. M13 is `test/13_m13_billing_operations.js` (126 checks), plus `test/01_migrations.js` (migration 006 up and down). Source: SRS Draft 2 only. Where it is silent the choice is listed under "Assumptions" and in `docs/API_CONTRACT.md` section 9, items 19 to 25.

## S097 Folio and charges model
> Migration 006. One folio per reservation, with an invoice number (INV-000001) and the tax name and rate recorded when the folio is made. A room charge per night records the night it is for (`stay_date`). A database trigger refuses to edit or delete a recorded charge; a mistake is voided (`POST /api/reservations/{id}/charges/{chargeId}/void`, reason required, stays visible under `voided_charges`). Room nights change only by editing the reservation (old nights voided, new nights recorded). `GET /api/reservations/{id}/folio`. Checks: `test/13` (12).

## S098 Additional charges and add-ons
> `POST /api/reservations/{id}/charges` (moved out of server.js): description, quantity, unit price, or an approved add-on whose price is recorded at the time. Folio row is locked while posting. Voiding as in S097. Checks: `test/13` (3), plus the add-on checks in `test/11`.

## S099 Tax, service charge and discounts
> Tax rate comes from the property settings and is recorded on each folio. Discounts (`POST .../discounts`, PERCENT or FIXED, reason required, Administrator and Manager only, amount recorded when applied, `.../discounts/{id}/void`). Total = subtotal - discounts + tax on the remainder; balance = total - payments + completed refunds. Example in the test: 360 + 6% = 381.60; 10% off = 343.44. Checks: `test/13` (10). No separate service charge is built: SRS Draft 2 names only tax (see questions).

## S100 Payments and deposits
> `POST /api/reservations/{id}/payments`: amount, method (CASH, CARD, ONLINE, BANK_TRANSFER as before), `kind` PAYMENT or DEPOSIT, gateway reference (required for ONLINE, used once across all reservations), currency, note. `Idempotency-Key` header (or `idempotency_key` in the body): sending the same request again returns 200 with `Idempotent-Replay: true` and records nothing; the same key with another amount is a 409. The folio is locked, so two payments of the full balance at once record one and refuse one. Overpayment is refused. Receipt number RC-000001. Checks: `test/13` (14).

## S101 Refunds and reconciliation
> A refund is requested (`POST /api/refunds`, any role that can manage folios) and decided by an Administrator or Manager who is not the requester (`/approve`, `/reject`). A request changes no balance; an approval pays out once (two approvals at once: one wins). Requests together cannot exceed the payment. `GET /api/refunds` (filter by status). `GET /api/reconciliation?date=` (Administrator, Manager): payments, deposits, refunds and net for the day, by method, with issues (REFUNDS_EXCEED_PAYMENTS, OVERPAID, PAYMENT_STATUS_MISMATCH) found by recomputing every folio. Checks: `test/13` (22).

## S102 Invoice and receipt data
> `GET /api/reservations/{id}/invoice` (lines, discounts, tax, payments with receipt numbers, refunds, total, balance; property and guest), `GET /api/reservations/{id}/receipt` (settlement receipt, `settled` true when balance is 0), `GET /api/payments/{id}/receipt`. Data only: no PDF is made. Checks: `test/13` (8).

## S103 Housekeeping tasks
> `GET/POST /api/housekeeping/tasks`, `/{id}/assign|start|complete|cancel`, `GET /api/housekeeping/assignees`. Check-out makes the room CLEANING and creates a CHECKOUT_CLEAN task. Completing it makes the room AVAILABLE (and notifies ROOM_READY). A daily clean does not change the room. A room blocked meanwhile is not freed by the clean. Setting `post_stay_room_status` = AVAILABLE skips the cleaning step. Checks: `test/13` (16).

## S104 Maintenance reports and room blocking
> `POST /api/maintenance` (issue, severity, `block_room`). Blocking puts the room in MAINTENANCE_BLOCKED and lists the confirmed bookings affected (it does not move or cancel them, and does not change stock). An occupied room cannot be blocked. Release (`/resolve` or `/cancel`, Administrator and Manager): when the last blocking report is closed the room goes to CLEANING with an INSPECTION task. `PATCH /api/rooms/{id}/status` refuses to leave MAINTENANCE_BLOCKED while a blocking report is open. Checks: `test/13` (15).

## S105 Policies, settings and notifications
> `GET/PATCH /api/settings` (tax name and rate, check-in and check-out time, cancellation policy text, hold minutes, post-stay room status); separate per property; changes audited. Hold length now comes from the setting. Notifications: events REFUND_REQUESTED, REFUND_DECIDED, MAINTENANCE_REPORTED, ROOM_READY; per-user preferences per channel; in-app inbox with read marks; delivery logs for Administrator and Manager. E-mail is only QUEUED because there is no mail server; it is never marked delivered. Checks: `test/13` (18 plus the settings checks inside S097/S099).

## S106 Reports and dashboard summary
> `GET /api/reports/occupancy?from&to` (per day: rooms, occupied, %, room revenue; totals with ADR and RevPAR), `/payments` (Administrator, Manager), `/summary` (today's arrivals, departures due, in-house, room statuses, occupancy, open housekeeping and maintenance, pending refunds, bookings by source in 30 days; money figures are null for Front Desk). Days are Malaysia time (UTC+8). Every figure in the tests is compared with a separate query on the database. Checks: `test/13` (8).

## Bugs found by these tests and fixed
1. The notification insert used one parameter as two types; real PostgreSQL and the built-in engine both refused it, so every refund request failed with a 500. Fixed with a cast.
2. Check-out failed when the property setting "post-stay status" was AVAILABLE (occupied -> available is not an allowed room move). Check-out now goes through CLEANING first.

## What is not done or not verified
1. Nothing here has been reviewed by a teammate; no hours are logged.
2. Tested on the built-in engine and one real PostgreSQL 16 server only, not on the team's own setup. Not run on Windows by me.
3. The FDS web app does not call these endpoints; only sign-in and Staff are connected.
4. The two-things-at-once checks (payments, refund approval) prove the locking only on real PostgreSQL.
5. No PDF invoice, no real e-mail, no payment gateway: the gateway reference is just text the front desk types.
6. The ERD and the Excel workbook do not yet show the new tables (`folio_discounts`, `refunds`, `property_settings`, `housekeeping_tasks`, `maintenance_reports`, `notification_preferences`, `notification_logs`) or new columns (see migration 006).

## Assumptions (also in the contract, section 9)
Recorded charges never change, only voided. Tax is one rate per property, recorded on the folio. Discounts only by Administrator or Manager. A refund needs a second person's approval. Room goes to CLEANING after check-out and after maintenance release unless the setting says otherwise. Notifications default to in-app only. Reports use UTC+8 days.

## Questions for the team
1. Eric: is there a service charge as well as tax, and is tax per property or per room type?
2. Eric: who may approve refunds, and is a limit (amount) needed? Today Administrator or Manager, not the requester.
3. Eric: may a discount be given by Front Desk up to some limit? Today no.
4. Eric: should a room go straight to AVAILABLE after check-out, or always through cleaning (default)?
5. Eric: which notifications and channels are really needed (e-mail needs a mail service)?
6. Ivan: please add the new tables and columns to the ERD and the database check (S059).
