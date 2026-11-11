# Evidence for M17, M18, M19, M21, M22 (Chester's subtasks only)

Paste each work note into column P of the Subtask sheet. Do not set Progress to 100% or enter a Completed date until the reviews below have happened. Estimated and logged hours are yours to fill in. Nothing here has been reviewed by a teammate.

Automated checks: `npm test` runs 893 checks in 14 files, all passing, on the built-in engine and on one real PostgreSQL 16 server (Linux). New: `test/14_m17_m21_approvals_booking_engine.js` (131 checks) and migration 007 in `test/01_migrations.js`. Source: SRS Draft 2 only. Not covered: subtasks of Qiwei, Eric and Ivan (S136, S139-S141, S143-S144, S146-S149, S152-S156, S176, S181-S183). Back end only: no front end was built or connected. Where the SRS is silent the choice is listed under "Assumptions" and in `docs/API_CONTRACT.md` (assumptions 26 to 31).

## M17 Manager approval API
S133 > Approval API open only to Administrator and to a Manager given the right to approve rates (`rates.approve`). Front Desk, a Manager without the right, no token and a signed-out (revoked) session are refused (403/401/SESSION_REVOKED); taking the right away works at once. Checks: test/14 (5).
S134 > `GET /api/approvals` (status, kind, limit), `GET /api/approvals/summary` (counts by kind, oldest), `GET /api/approvals/{kind}/{id}`. One inbox over new room types (with their rate), rate changes and add-ons. Detail shows current vs new values. Other property = 404. Checks: (10).
S135 > `POST /api/approvals/{kind}/{id}/approve`: same rules as the desktop endpoints (they now call the same code): room type + rate approved together, rate change ends the old rate today, add-on becomes available. Checks: (4).
S137 > Decision record: who, when, reason; reject needs a reason of 3 to 300 characters; rejected item is removed and a copy is kept in the history (`approval_decisions`); audit trail written; desktop decisions are recorded in the same history. Checks: (9).
S138 > Each request has a `revision` (hash of its key values). Approving a request that changed since it was opened gives STALE_REQUEST (409); an already decided one gives INVALID_STATE naming who decided; unknown = 404. Checks: (8).

## M18 Mobile approval flows (back end side only)
S142 > Role checks for the app's endpoints. The SRS has no housekeeping role, so the check is done with Front Desk and with a Manager without the right. Checks: (1) plus the 5 under S133.
S145 > Repeated taps and simultaneous decisions: decision made inside one transaction after locking the row. Six taps at once: one applied, five refused, one record. Approve and Reject together: one wins and data matches. Two managers on one price change: applied once. Checks: (4). The SRS describes no manager mobile app; this is the API such an app would use.

## M19 Business rules (decisions, S150 and S151)
S150 > Decision note below. Implemented: online deposit percentage (default 100), free cancellation window (48 h), late cancellation fee (100 %), all property settings validated and changed by management only. Checks: (2).
S151 > Hold time = time to pay, 1 to 60 minutes (existing setting), with an automatic expiry timer (`HOLD_SWEEP_SECONDS`, default 30) plus a sweep on each request. Checks: (1) plus S180.

### Decision note S150/S151
| Question | Options | Implemented default (change by setting) |
|---|---|---|
| Pay full or deposit online | full / percentage | 100 % (`online_deposit_pct`) |
| Free cancellation | none / fixed hours | free until 48 h before check-in (UTC+8) |
| Late cancellation fee | none / first night / % | 100 % of total (`late_cancel_fee_pct`) |
| Refund after cancel | automatic / approved | requested, a manager must approve (M13 rule, requester cannot approve own) |
| Time to pay | 5 / 15 / 30 min | the hold time (setting, 1-60 min) |
Ask Eric to confirm.

## M21 Guest booking engine
S166 > `GET /api/public/availability` without sign-in; no guest data or stock internals. (6)
S167 > Price per room type with tax, computed by the server. (5)
S168 > `POST /api/public/bookings` starts an attempt and holds the room; stock locked, so no overbooking. (4+1)
S169 > Server prices everything; client price fields are refused; `expected_total` mismatch gives PRICE_CHANGED. (8)
S170 > Access token (48 hex, only its hash stored) in `X-Booking-Token`; missing 401, wrong 404. (3)
S171 > Payment session, one open per attempt, reference PS-xxxx, amount and currency from the server. (7)
S172 > Webhook `POST /api/public/payments/webhook`: HMAC-SHA256 signature of the raw body (`X-Signature`), amount/currency/reference checked. (6)
S173 > Confirmation turns the hold into a reservation (source "Direct website") with the online payment recorded. (5)
S174 > Confirmation e-mail queued in `email_outbox` (`GET /api/email-outbox`); nothing is sent. (4)
S175 > Public limits: per-IP rate limit (429), max 3 unpaid attempts per e-mail, hostile input handling. (14)

## M22 Testing of the booking engine
S177 > Last-room duel, website against front desk, also 6 parallel attempts: exactly one wins. (7)
S178 > Hostile inputs: bad dates, wrong types, SQL-like text, oversized bodies, foreign tokens. (6)
S179 > Duplicate, delayed and failed webhooks: duplicate ignored (DUPLICATE), failed releases the hold, late success re-reserves if free, otherwise PAID_UNFULFILLED and staff notified. (6)
S180 > Hold expiry by the timer, also for unpaid attempts and payment sessions. (5)

## Bugs found while testing
Notification insert type error (fixed with a cast); check-out to AVAILABLE failed when the setting said so (now goes via CLEANING); several test slips (listed in the work log, none hid a product bug).

## Not done / not verified
- No payment gateway is chosen; the webhook format and signature are my assumption. The system cannot refund at the gateway.
- No e-mail service: messages are only queued.
- Folio is not adjusted for a cancellation fee.
- Rejection removes the pending item (no REJECTED status on the item).
- ERD and workbook do not yet show the new tables (migration 006: 7 tables; 007: approval_decisions, booking_attempts, payment_sessions, payment_events, email_outbox; new settings columns; reservations.cancel_fee). Total 32 tables.
- Tested on one PostgreSQL 16 server on Linux with Node 22, not on Windows. Repo asks for Node 24.
- Only sign-in and Staff screens are connected to the API; nothing of this is shown in a screen.

## Questions
Eric: which gateway and webhook format; deposit or full payment; time to pay; cancellation window, fee and refund approval; e-mail service; who approves. Ivan: ERD and database check for the new tables.
