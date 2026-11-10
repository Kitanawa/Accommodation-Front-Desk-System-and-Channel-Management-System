# FDS API Contract (S055)

Version 0.8, October 2026. Owner: Chester (backend). Consumers: Qiwei (front end), Ivan (environment, audit events). Business rules: Eric.

This file is generated from `docs/contract.js` (the same file produces `openapi.yaml`), and a test checks that every endpoint marked *implemented* really exists in the server and that none is missing here.

**Status:** all 121 endpoints run today.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `http://localhost:3000` in development. All paths start with `/api`. |
| Format | JSON in and out, UTF-8, header `Content-Type: application/json`. |
| Authentication | `Authorization: Bearer <token>` on every call except those marked Public. |
| Versioning | None in the path. This file's version changes when a field is removed or renamed. Adding fields is not a breaking change, so ignore fields you do not know. |
| Success body | The resource itself, or an array. No wrapper object. Creating something returns 201; everything else 200. |
| Lists | A plain array, newest first. Most lists return at most 200 rows. `GET /api/reservations` is paged (S082): `page` and `page_size` query parameters, and the headers `X-Total-Count`, `X-Page`, `X-Page-Size`, `X-Total-Pages`. The body stays a plain array. |
| Empty values | A missing optional value is `null`, never an empty string. Send `null` or leave the field out. |
| Cross-origin | CORS is open (`*`) so a front end on another port can call the API. |
| Request id | Every response has an `X-Request-Id` header. Errors repeat it in the body. Quote it when reporting a problem. |

## 2. Identifiers

| Kind | Format | Example |
|---|---|---|
| Resource ids (`user_id`, `reservation_id`, `room_id`, `room_type_id`, `rate_rule_id`, `folio_id`, `guest_id`, `charge_id`, `payment_id`, `session_id`, `property_id`) | UUID v4, lower case | `3f2a9c10-5b1e-4c7a-9d2e-8b1c4e22a001` |
| Lookup ids (`source_id`, `role_id`, `status_id`) | Small whole number. Prefer the `code` / `name` fields in screens. | `4` |
| `audit_id` | Whole number, increasing | `10452` |
| `reservation_ref` | Human reference the guest and staff read out: `R-` plus 6 capital letters or digits. Not an id: use `reservation_id` in URLs. | `R-K3F9QA` |

A resource id in a URL that is not a UUID returns `400 VALIDATION_ERROR` (field `id`). A well-formed id that does not exist in your property returns `404 NOT_FOUND`.

## 3. Data formats

| Type | Format | Example |
|---|---|---|
| Date | `YYYY-MM-DD`, property local date (Kuching, UTC+8) | `2026-11-01` |
| Time of day | `HH:MM` | `15:00` |
| Timestamp | ISO 8601 in UTC with `Z` | `2026-10-16T05:57:00.000Z` |
| Money | JSON number with at most 2 decimals, in the property currency (MYR). Never a string. | `260.00` is sent as `260` |
| Status and type values | Upper-case words with underscores, exactly as listed per field | `CHECKED_IN` |
| Check-out date | Exclusive: a stay from 1 Nov to 3 Nov uses the nights of 1 Nov and 2 Nov. | |
| Weekday numbers | 0 = Sunday to 6 = Saturday (`selected_days`) | `[5, 6]` = Friday, Saturday |

## 4. Sign-in and sessions

- `POST /api/login` returns a `token` and its `expires_at`. Keep the token in memory or session storage and send it as a Bearer token.
- A session lasts at most **8 hours** and ends after **60 minutes without any request**. Both are settings (`SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES`).
- The server keeps sessions in the database and can end them at any time. Logging out, a password change, deactivating the account or an administrator revoking sessions all end them. The next call returns `401 SESSION_REVOKED`. A session that ran out returns `401 SESSION_EXPIRED`. The front end should react to any 401 by showing the sign-in screen.
- **5 wrong passwords in a row** lock the account for **15 minutes** (`429 ACCOUNT_LOCKED`), even for the correct password. An administrator reset also unlocks it.
- A wrong password and an unknown email give the identical answer (`INVALID_CREDENTIALS`) so the API does not reveal which emails exist.
- The role is read from the database on every request. A role change or deactivation applies immediately; the token does not carry the role.
- Passwords are stored only as scrypt hashes. Tokens are stored only as SHA-256 hashes. Neither ever appears in a response.


### 4a. The FDS web app (apps/fds-web)

The web app signs in with a **cookie** and has its own formats, so these endpoints sit beside the main ones and call the same code. Every rule, audit record and session rule is shared.

| | Main API | Web app endpoints (`/api/auth/*`, `/api/staff*`) |
|---|---|---|
| Credential | `Authorization: Bearer <token>` | HttpOnly cookie `fds_session` (also accepted by every other endpoint) |
| Changing requests with the cookie | n/a | must send the header `X-App-Request: 1`, else `403 FORBIDDEN` |
| Role names | `ADMINISTRATOR`, `OWNER_MANAGER`, `FRONT_DESK` | `admin`, `manager`, `front_desk` |
| Account state | `is_active` true / false | `status` `active` / `disabled` (`pending` is not supported) |
| Errors | `{ "error": { "code", "message", "fields", "request_id" } }` | `{ "error": "text", "code", "fields", "request_id" }`: the text joins the field messages |

The cookie is `HttpOnly; SameSite=Lax; Path=/` and lasts as long as the session. Set `COOKIE_SECURE=true` (or serve over HTTPS behind a proxy that sends `X-Forwarded-Proto: https`) to add `Secure`.
Run the API on port **3001** (`set PORT=3001`): that is where the web app's dev server forwards `/api`.

## 5. Roles, permissions and property scope

Every endpoint is checked on the server (SRS section 4). Hiding a button in the screen is not security. The "Who" line of each endpoint comes from this table.

| Permission | What it covers | Administrator | Manager | Front Desk |
|---|---|---|---|---|
| `users.view` | See staff accounts | Yes | Yes | - |
| `users.manage_any` | Create / edit any staff account and role | Yes | - | - |
| `users.manage_frontdesk` | Create / edit Front Desk accounts | Yes | Front Desk only | - |
| `catalog.view` | See room categories, room types, rooms | Yes | Yes | Yes |
| `catalog.manage` | Manage room categories and types (M09) | Yes | Yes | - |
| `stock.view` | See room stock | Yes | Yes | Yes |
| `stock.manage` | Manage room stock (M09) | Yes | Yes | - |
| `rates.view_approved` | See approved rates | Yes | Yes | Yes |
| `rates.view_all` | See pending rates too | Yes | Yes | - |
| `rates.manage` | Create / edit rates | Yes | Yes | - |
| `rates.approve` | Approve rates | Yes | only if enabled | - |
| `reservations.manage` | Search availability; create, edit, cancel reservations | Yes | Yes | Yes |
| `stay.operate` | Assign rooms, check in, check out, change room status | Yes | Yes | Yes |
| `folio.manage` | Folio, charges and payments | Yes | Yes | Yes |
| `billing.discount` | undefined | Yes | Yes | - |
| `billing.refund` | undefined | Yes | Yes | - |
| `settings.view` | undefined | Yes | Yes | Yes |
| `settings.manage` | undefined | Yes | Yes | - |
| `maintenance.release` | undefined | Yes | Yes | - |
| `integration.manage` | Change channel / integration settings (later) | Yes | - | - |
| `integration.view` | See channel / integration settings (later) | Yes | Yes | - |
| `reports.full` | Full reports (later) | Yes | Yes | - |
| `reports.operational` | Dashboard (operational information) | Yes | Yes | Yes |
| `audit.view` | Read the audit log | Yes | Yes | - |

- **Approve rates is Configurable for Managers.** A Manager can approve only when `can_approve_rates` is true on their account (shown in `GET /api/me`).
- **Manage users: Manager is "Limited".** This contract reads that as: a Manager can see all accounts and create / edit / reset Front Desk accounts only; only an Administrator can touch Administrator and Manager accounts, roles and `can_approve_rates`. *(Assumption, see section 9.)*
- **Property scope.** Every record belongs to one property and a user only ever sees their own property's records: reservations, rooms, room types, rates, users and audit records. A record from another property returns `404 NOT_FOUND`, exactly as if it did not exist, never 403.
- Calling an endpoint your role may not use returns `403 FORBIDDEN`.

## 6. Errors

Every error, from every endpoint, has this shape and nothing else:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the fields listed.",
    "fields": [
      { "field": "check_in", "message": "Check-in cannot be in the past." },
      { "field": "guest.full_name", "message": "Guest full name is required." }
    ],
    "request_id": "6f1c2a9e-0d3b-4c61-8c7e-1f2a3b4c5d6e"
  }
}
```

- `code` is stable and meant for programs: branch on it. `message` is plain English meant for people and may be shown as is; do not branch on it.
- `fields` is present for `VALIDATION_ERROR` and lists **every** wrong field at once. `field` is the name in the request body (or query); a dot means a nested field.
- The HTTP status is fixed per code (table below). Responses are never 200 with an error inside.
- `request_id` equals the `X-Request-Id` response header.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | A field is missing or wrong. "fields" lists each problem. |
| `UNAUTHENTICATED` | 401 | No valid token was sent. Sign in. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password. The message never says which one. |
| `SESSION_REVOKED` | 401 | The session was ended (logout, password change, deactivation or revocation). |
| `SESSION_EXPIRED` | 401 | The session passed its lifetime or was idle too long. |
| `FORBIDDEN` | 403 | The signed-in role is not allowed to do this (SRS section 4). |
| `ACCOUNT_DISABLED` | 403 | The account is deactivated. |
| `NOT_FOUND` | 404 | No such record in your property (a record of another property looks the same). |
| `CONFLICT` | 409 | The value already exists. |
| `INVALID_STATE` | 409 | The record is in a state that does not allow this action (for example cancelling a checked-in stay). |
| `SOLD_OUT` | 409 | No room of that type is left on at least one night. |
| `NO_STOCK` | 409 | No stock is configured for every night of the stay. |
| `NO_APPROVED_RATE` | 409 | At least one night has no approved rate. |
| `HOLD_EXPIRED` | 409 | The inventory hold ran out of time or was released. Search availability again. |
| `ROOM_NOT_AVAILABLE` | 409 | The room is blocked, occupied, cleaning, overlapping another stay, or the wrong type. |
| `BALANCE_OUTSTANDING` | 409 | Check-out needs a zero balance. |
| `FOLIO_CLOSED` | 409 | The folio is closed or the reservation is cancelled. |
| `STALE_REQUEST` | 409 | The request changed after the manager opened it. Open it again and check the new values. |
| `BASE_RATE_EXISTS` | 409 | The room type already has an approved Base Rate. |
| `INVALID_SIGNATURE` | 401 | The payment webhook signature does not match. Nothing was changed. |
| `PAYMENT_MISMATCH` | 409 | A payment result does not match the session the server created (amount, currency or reference). Nothing was changed. |
| `PRICE_CHANGED` | 409 | The price the guest saw is not the price the server calculates now. Show the new price. |
| `RATE_LIMITED` | 429 | Too many requests from this address. Wait a minute. |
| `ACCOUNT_LOCKED` | 429 | Too many wrong passwords. Locked for 15 minutes. |
| `INTERNAL_ERROR` | 500 | Unexpected server problem. Quote the request_id. |

Examples:

```json
{ "error": { "code": "SOLD_OUT", "message": "Family Suite is sold out on 2026-11-02.", "request_id": "..." } }
{ "error": { "code": "UNAUTHENTICATED", "message": "Please sign in.", "request_id": "..." } }
{ "error": { "code": "ACCOUNT_LOCKED", "message": "Too many wrong passwords. Try again in 15 minute(s).", "request_id": "..." } }
```

## 7. Example: sign in, then book

```
POST /api/login
{ "email": "frontdesk@fds.test", "password": "Meadow-Demo-2026" }

200
{ "token": "q3...", "expires_at": "2026-10-16T13:30:00.000Z",
  "user": { "user_id": "8b1c...", "name": "Front Desk Staff", "email": "frontdesk@fds.test",
            "role": "FRONT_DESK", "can_approve_rates": false, "property_id": "3f2a..." } }
```

```
POST /api/reservations          (Authorization: Bearer q3...)
{ "guest": { "full_name": "Guest One", "phone": "+60 12-000 0000" },
  "room_type_id": "a001...", "check_in": "2026-11-01", "check_out": "2026-11-03",
  "total_guests": 2, "source_id": 1, "estimated_arrival": "15:00" }

201
{ "reservation_id": "b701...", "reservation_ref": "R-K3F9QA" }
```

## 8. Endpoint reference

### Sign in

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `POST /api/login` | Public | Implemented | Sign in with email and password. Returns a session token. |
| `POST /api/logout` | Any signed-in user | Implemented | End the current session. |
| `GET /api/me` | Any signed-in user | Implemented | The signed-in user. |
| `GET /api/info` | Public | Implemented | Which database the server is using. |

**`POST /api/login`** returns 200 `LoginResponse`. Errors: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `email` | string | Yes |  |
| `password` | string | Yes |  |

**`POST /api/logout`** returns 200 `Ok`. Errors: only the standard ones.

**`GET /api/me`** returns 200 `User`. Errors: only the standard ones.

### Sessions

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/sessions` | Any signed-in user | Implemented | My active sessions (the current one is marked). |
| `DELETE /api/sessions/{id}` | Any signed-in user | Implemented | End one of my sessions. |
| `POST /api/sessions/revoke-others` | Any signed-in user | Implemented | End all my sessions except this one. |

**`DELETE /api/sessions/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

### Reference data

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/sources` | Any signed-in user | Implemented | Booking sources (Walk-in, Phone, Email, Website, Travel agent, OTA). |
| `GET /api/dashboard` | All roles | Implemented | Today's arrivals and departures, in-house count, room occupancy and pending rates (pending_rates is null for Front Desk). |

### Room types

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/room-types` | All roles | Implemented | Room types of my property. Front Desk sees APPROVED types only; Administrator and Manager also see PENDING ones. |
| `GET /api/room-types/{id}` | All roles | Implemented | One room type with its rates and rooms (Front Desk sees approved rates only). |
| `POST /api/room-types` | Administrator, Manager | Implemented | S067: submit a room type together with its rates. Everything starts PENDING; the type cannot be sold until approved. |
| `PATCH /api/room-types/{id}` | Administrator, Manager | Implemented | Change room type details. Details take effect at once; only rates need approval. |
| `POST /api/room-types/{id}/approve` | Administrator; Manager only if can_approve_rates | Implemented | S067: approve a PENDING room type and its pending rates in one step. Needs a pending Base Rate. |
| `DELETE /api/room-types/{id}` | Administrator, Manager | Implemented | Withdraw a room type that is still PENDING and has no reservations (its rates and rooms go with it). |

**`GET /api/room-types/{id}`** returns 200 `RoomTypeDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`POST /api/room-types`** returns 201 `RoomTypeSubmitted`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `category_id` | UUID | Yes |  |
| `name` | string | Yes | 2 to 100 characters, unique in the category ignoring upper/lower case. |
| `max_guests` | int | Yes | 1 to 20. |
| `min_nights` | int | No | 1 to 365, default 1. |
| `description` | string | No | Up to 2000 characters. |
| `facilities` | string[] | No | Up to 40 names, each 1 to 60 characters; repeats are dropped. |
| `photos` | Photo[] | No | Up to 20. Metadata only: url (http(s) or a path starting with /), caption, alt, sort_order. |
| `layout_info` | string | No | Up to 500 characters. |
| `rates` | RateInput[] | No | If given, exactly one BASE rate is required. Same rules as POST /api/rates. |

**`PATCH /api/room-types/{id}`** returns 200 `RoomType`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `category_id` | UUID | No |  |
| `name` | string | No |  |
| `max_guests` | int | No |  |
| `min_nights` | int | No |  |
| `description` | string | No |  |
| `facilities` | string[] | No |  |
| `photos` | Photo[] | No |  |
| `layout_info` | string | No |  |

**`POST /api/room-types/{id}/approve`** returns 200 `RoomTypeApproved`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

**`DELETE /api/room-types/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

### Room categories

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/room-categories` | All roles | Implemented | Room categories with the number of room types in each. |
| `POST /api/room-categories` | Administrator, Manager | Implemented | S060: create a room category. The name must be unique ignoring upper/lower case. |
| `PATCH /api/room-categories/{id}` | Administrator, Manager | Implemented | Rename a room category. |
| `DELETE /api/room-categories/{id}` | Administrator, Manager | Implemented | Delete an empty room category. |

**`POST /api/room-categories`** returns 201 `RoomCategory`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 2 to 80 characters. |

**`PATCH /api/room-categories/{id}`** returns 200 JSON. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 2 to 80 characters. |

**`DELETE /api/room-categories/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

### Reservations

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/availability` | All roles | Implemented | S079: rooms left, nightly rates and total for a stay, per room type. Holds that ran out of time are given back first, and live holds count as taken. |
| `GET /api/frontdesk/state` | All roles | Implemented | Everything the staff web app needs in one read: property settings, rooms, reservations (with guest, charges and payments) and housekeeping, shaped the way the staff web app keeps them. |
| `GET /api/calendar` | All roles | Implemented | Read-only room calendar for the Booking page: for each approved room type and each night, rooms left, total rooms and the nightly rate. |
| `POST /api/holds` | All roles | Implemented | S080: keep one room of a type for a stay for a few minutes while the guest decides. The room counts as taken at once. |
| `GET /api/holds/{id}` | All roles | Implemented | S080: the state of a hold (ACTIVE, CONFIRMED, RELEASED or EXPIRED). |
| `DELETE /api/holds/{id}` | All roles | Implemented | S080: release a hold and give the room back at once. |
| `POST /api/holds/{id}/confirm` | All roles | Implemented | S080: turn a live hold into a reservation in one transaction. Dates, room type and guest count come from the hold. An expired hold returns HOLD_EXPIRED. |
| `POST /api/reservations` | All roles | Implemented | S081: create a reservation for a walk-in or phone guest (any source). Also creates its folio and one ROOM charge per night, and takes one room from stock in the same transaction. |
| `GET /api/reservations` | All roles | Implemented | S082: search, filter, sort and page reservations. The body is an array; paging is in the headers X-Total-Count, X-Page, X-Page-Size and X-Total-Pages. |
| `GET /api/reservations/{id}` | All roles | Implemented | One reservation with its folio: charges, payments and balance. |
| `PATCH /api/reservations/{id}` | All roles | Implemented | S083: edit guest details, notes and arrival time; change dates, room type or guest count of a CONFIRMED reservation (stock moves and room charges are priced again); extend the check-out of a CHECKED_IN stay (only the new nights are priced). |
| `POST /api/reservations/{id}/cancel` | All roles | Implemented | S084: cancel a CONFIRMED reservation. The remaining nights (today and later) go back to stock and any assigned room is freed. |
| `POST /api/reservations/{id}/no-show` | All roles | Implemented | S085: mark a CONFIRMED reservation as NO_SHOW on or after its arrival date. A remark is mandatory. The remaining nights go back to stock and the action is audited. |

**`GET /api/availability`** returns 200 `AvailabilityItem[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `from` | date | Yes | Check-in, not in the past. check_in is accepted as the same thing. |
| `to` | date | Yes | Check-out, after from, at most 90 nights. check_out is accepted as the same thing. |
| `guests` | int | No | Whole number 1 to 20. Default 1. |
| `room_type_id` | UUID | No | Only this room type. |

**`GET /api/calendar`** returns 200 `Calendar`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `from` | date | Yes | First night shown. |
| `days` | int | No | Number of nights, 1 to 62. Default 14. |

**`POST /api/holds`** returns 201 `Hold`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `NO_STOCK`, `SOLD_OUT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_type_id` | UUID | Yes |  |
| `check_in` | date | Yes |  |
| `check_out` | date | Yes |  |
| `total_guests` | int | Yes |  |
| `minutes` | int | No | 1 to 60. Default 15. |

**`GET /api/holds/{id}`** returns 200 `Hold`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`DELETE /api/holds/{id}`** returns 200 `Hold`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

**`POST /api/holds/{id}/confirm`** returns 201 `ReservationCreated`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `HOLD_EXPIRED`, `INVALID_STATE`, `NO_APPROVED_RATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `guest` | object | No | New guest: full_name, phone, email, nationality, id_passport_no, address. full_name is required. |
| `guest_id` | UUID | No | Use an existing guest instead of guest. |
| `source_id` | int | No | From GET /api/sources. Default 1. |
| `estimated_arrival` | time | No |  |
| `special_requests` | string | No |  |
| `notes` | string | No |  |

**`POST /api/reservations`** returns 201 `ReservationCreated`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `NO_APPROVED_RATE`, `NO_STOCK`, `SOLD_OUT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `guest` | object | No | New guest: full_name, phone, email, nationality, id_passport_no, address. full_name is required. |
| `guest_id` | UUID | No | Use an existing guest instead of guest. |
| `room_type_id` | UUID | Yes |  |
| `check_in` | date | Yes |  |
| `check_out` | date | Yes | Exclusive: the night of this date is not booked. |
| `total_guests` | int | Yes |  |
| `source_id` | int | No | From GET /api/sources, 1 to 6. Default 1 (Walk-in); 2 is Phone. |
| `estimated_arrival` | time | No |  |
| `special_requests` | string | No |  |
| `notes` | string | No |  |

**`GET /api/reservations`** returns 200 `ReservationRow[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `q` | string | No | Matches reference, guest name, phone, email or room number. |
| `status` | one of CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED, NO_SHOW | No |  |
| `payment_status` | one of UNPAID, PARTIAL, PAID | No |  |
| `source_id` | int | No | 1 to 6. |
| `room_type_id` | UUID | No |  |
| `check_in_from` | date | No |  |
| `check_in_to` | date | No |  |
| `check_out_from` | date | No |  |
| `check_out_to` | date | No |  |
| `sort` | one of check_in, check_out, created_at, guest, reference, total | No | Default check_in. |
| `order` | one of asc, desc | No | Default desc. |
| `page` | int | No | Default 1. |
| `page_size` | int | No | 1 to 100. Default 25. |

**`GET /api/reservations/{id}`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`PATCH /api/reservations/{id}`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `NO_APPROVED_RATE`, `NO_STOCK`, `ROOM_NOT_AVAILABLE`, `SOLD_OUT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | No |  |
| `phone` | string | No |  |
| `email` | string | No |  |
| `special_requests` | string | No |  |
| `notes` | string | No |  |
| `estimated_arrival` | time | No |  |
| `check_in` | date | No |  |
| `check_out` | date | No |  |
| `room_type_id` | UUID | No |  |
| `total_guests` | int | No |  |

**`POST /api/reservations/{id}/cancel`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `remark` | string | No | At most 300 characters. |

**`POST /api/reservations/{id}/no-show`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `remark` | string | Yes | Required, at most 300 characters. |

### Guests

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/guests` | All roles | Implemented | Guest profiles of my property, newest details first by name. q filters by name, phone or e-mail. |
| `POST /api/guests` | All roles | Implemented | Add a guest profile that can be used for later reservations. |
| `PATCH /api/guests/{id}` | All roles | Implemented | Change a guest profile. Reservations already made keep their own guest details. |
| `DELETE /api/guests/{id}` | Administrator, Manager | Implemented | Delete a guest profile (Administrator, Manager). The profile is hidden; reservation history is kept. |

**`GET /api/guests`** returns 200 `Guest[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `q` | string | No | Part of a name, phone or e-mail. |

**`POST /api/guests`** returns 201 `Guest`. Errors: `VALIDATION_ERROR`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | Yes | 1 to 120 characters. |
| `phone` | string | No |  |
| `email` | string | No | A valid e-mail address. |
| `nationality` | string | No |  |
| `id_passport_no` | string | No |  |
| `address` | string | No |  |
| `language` | string | No |  |
| `requests` | string | No |  |

**`PATCH /api/guests/{id}`** returns 200 `Guest`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | No | 1 to 120 characters. |
| `phone` | string | No |  |
| `email` | string | No | A valid e-mail address. |
| `nationality` | string | No |  |
| `id_passport_no` | string | No |  |
| `address` | string | No |  |
| `language` | string | No |  |
| `requests` | string | No |  |

**`DELETE /api/guests/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

### Stay

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/reservations/{id}/free-rooms` | All roles | Implemented | Rooms of the booked type that are free for the stay. |
| `POST /api/reservations/{id}/assign-room` | All roles | Implemented | Assign a physical room. For a guest already in the house this is a room move: the new room must be ready now, it becomes Occupied, and the room they leave goes to cleaning. |
| `POST /api/reservations/{id}/check-in` | All roles | Implemented | S086: check in. Needs a CONFIRMED reservation on or after its arrival date and before its check-out date, and a room that is Available and not used by another stay (the given room_id, the assigned room, or the first free one). The room becomes OCCUPIED. |
| `POST /api/reservations/{id}/check-out` | All roles | Implemented | S087: check out. Needs a zero balance. The room becomes CLEANING (dirty), the folio closes, and the nights of an early departure go back to stock. |

**`GET /api/reservations/{id}/free-rooms`** returns 200 `FreeRoom[]`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`POST /api/reservations/{id}/assign-room`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `ROOM_NOT_AVAILABLE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_id` | UUID | Yes |  |

**`POST /api/reservations/{id}/check-in`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `ROOM_NOT_AVAILABLE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_id` | UUID | No | Optional: choose the room at check-in. |

**`POST /api/reservations/{id}/check-out`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `BALANCE_OUTSTANDING`, `INVALID_STATE`.

### Folio

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/reservations/{id}/folio` | All roles | Implemented | S097: the folio of a reservation: active and voided charges, discounts, payments, refunds, tax and balance. A folio is created together with its reservation (one per reservation). |
| `POST /api/reservations/{id}/charges` | All roles | Implemented | S098: post a charge to the folio: an additional charge, or an approved add-on (S069). The price is recorded when the charge is made and can never be edited or deleted; a later add-on price change does not touch it. |
| `POST /api/reservations/{id}/charges/{chargeId}/void` | All roles | Implemented | S097: void an additional or add-on charge that was a mistake. A reason is required and the charge stays visible under voided_charges. Room nights change by editing the reservation. |
| `POST /api/reservations/{id}/discounts` | Administrator, Manager | Implemented | S099: give a percentage or fixed discount. Administrator and Manager only. The amount is recorded now. Tax is worked out after discounts. |
| `POST /api/reservations/{id}/discounts/{discountId}/void` | Administrator, Manager | Implemented | S099: remove a discount that was given by mistake. |
| `POST /api/reservations/{id}/payments` | All roles | Implemented | S100: record a payment or a deposit (a deposit may be taken before check-in). Cannot be more than the balance. Duplicates are refused: the same Idempotency-Key header (or idempotency_key) returns the first payment (200 with header Idempotent-Replay) and records nothing new; a gateway reference can be used once. |
| `GET /api/refunds` | All roles | Implemented | S101: refunds of this property, newest first (at most 200). |
| `POST /api/refunds` | All roles | Implemented | S101: ask to refund all or part of a completed payment. It changes no balance until it is approved. |
| `POST /api/refunds/{id}/approve` | Administrator, Manager | Implemented | S101: approve a requested refund (Administrator or Manager, and not the person who requested it). The refund is paid out and the balance is recalculated. |
| `POST /api/refunds/{id}/reject` | Administrator, Manager | Implemented | S101: reject a requested refund. |
| `GET /api/reconciliation` | Administrator, Manager | Implemented | S101: payments, deposits and refunds of one day by method, and folios whose figures do not agree (refunds above payments, overpaid, wrong payment status). |
| `GET /api/reservations/{id}/invoice` | All roles | Implemented | S102: invoice data (DRAFT while the folio is open, FINAL after check-out): lines, discounts, tax, total, payments, refunds and balance. |
| `GET /api/reservations/{id}/receipt` | All roles | Implemented | S102: settlement receipt data (FR-11): every payment and refund of the stay and the balance left. |
| `GET /api/payments/{id}/receipt` | All roles | Implemented | S102: receipt data for one payment or deposit. |

**`GET /api/reservations/{id}/folio`** returns 200 `Folio`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`POST /api/reservations/{id}/charges`** returns 201 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `FOLIO_CLOSED`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `description` | string | No | Up to 200 characters. Required unless add_on_id is sent (then the add-on name is used). |
| `quantity` | number | No | Greater than 0. Default 1; for an add-on: 1 per stay, nights per night, guests per guest. |
| `unit_price` | number | No | 0 or more. Required without add_on_id; not allowed with it. |
| `add_on_id` | UUID | No | An approved, active add-on. |

**`POST /api/reservations/{id}/charges/{chargeId}/void`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `FOLIO_CLOSED`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | Yes | 3 to 200 characters. |

**`POST /api/reservations/{id}/discounts`** returns 201 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `FOLIO_CLOSED`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `kind` | one of PERCENT, FIXED | Yes |  |
| `value` | number | Yes | Percent: above 0 up to 100. Fixed: an amount above 0. At most 2 decimals. |
| `reason` | string | Yes | 3 to 200 characters. |

**`POST /api/reservations/{id}/discounts/{discountId}/void`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `FOLIO_CLOSED`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | Yes | 3 to 200 characters. |

**`POST /api/reservations/{id}/payments`** returns 201 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `FOLIO_CLOSED`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `amount` | number | Yes | Greater than 0. |
| `method` | one of CASH, CARD, ONLINE, BANK_TRANSFER | Yes |  |
| `kind` | one of PAYMENT, DEPOSIT | No | Default PAYMENT. |
| `reference` | string | No | Gateway reference, at most 80 characters. Required for ONLINE. Unique. |
| `currency_code` | string | No | If sent, must be the folio currency. |
| `note` | string | No | At most 200 characters. |
| `idempotency_key` | string | No | Or send the Idempotency-Key header. At most 80 characters. |

**`GET /api/refunds`** returns 200 `Refund[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `status` | one of REQUESTED, COMPLETED, REJECTED | No |  |

**`POST /api/refunds`** returns 201 `Refund`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `payment_id` | UUID | Yes |  |
| `amount` | number | Yes | At most what is left of the payment after earlier refunds and requests. |
| `reason` | string | Yes | 3 to 200 characters. |

**`POST /api/refunds/{id}/approve`** returns 200 `Refund`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `note` | string | No | At most 200 characters. |

**`POST /api/refunds/{id}/reject`** returns 200 `Refund`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `note` | string | No | At most 200 characters. |

**`GET /api/reconciliation`** returns 200 `Reconciliation`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `date` | date | No | Default today. |

**`GET /api/reservations/{id}/invoice`** returns 200 `Invoice`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`GET /api/reservations/{id}/receipt`** returns 200 `SettlementReceipt`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`GET /api/payments/{id}/receipt`** returns 200 `PaymentReceipt`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

### Housekeeping

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/housekeeping/assignees` | All roles | Implemented | S103: active users of this property who can be given a task. |
| `GET /api/housekeeping/tasks` | All roles | Implemented | S103: cleaning tasks, open and in-progress first (at most 200). |
| `POST /api/housekeeping/tasks` | All roles | Implemented | S103: create a task by hand. Check-out creates a CHECKOUT_CLEAN task by itself (unless the property sets the post-stay status to AVAILABLE). |
| `POST /api/housekeeping/tasks/{id}/assign` | All roles | Implemented | S103: give an open or in-progress task to someone. |
| `POST /api/housekeeping/tasks/{id}/start` | All roles | Implemented | S103: start an open task (it is given to the caller if nobody has it). |
| `POST /api/housekeeping/tasks/{id}/complete` | All roles | Implemented | S103: finish a task. A checkout clean or inspection moves the room from CLEANING to AVAILABLE. |
| `POST /api/housekeeping/tasks/{id}/cancel` | All roles | Implemented | S103: cancel an open or in-progress task. |

**`GET /api/housekeeping/tasks`** returns 200 `HousekeepingTask[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `status` | one of OPEN, IN_PROGRESS, DONE, CANCELLED | No |  |
| `assigned_to` | string | No | A user id, or "me". |
| `room_id` | UUID | No |  |

**`POST /api/housekeeping/tasks`** returns 201 `HousekeepingTask`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_id` | UUID | Yes |  |
| `task_type` | one of CHECKOUT_CLEAN, DAILY_CLEAN, INSPECTION | No | Default DAILY_CLEAN. |
| `notes` | string | No | At most 300 characters. |
| `assigned_to` | UUID | No |  |

**`POST /api/housekeeping/tasks/{id}/assign`** returns 200 `HousekeepingTask`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `user_id` | UUID | Yes |  |

**`POST /api/housekeeping/tasks/{id}/start`** returns 200 `HousekeepingTask`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

**`POST /api/housekeeping/tasks/{id}/complete`** returns 200 `HousekeepingTask`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

**`POST /api/housekeeping/tasks/{id}/cancel`** returns 200 `HousekeepingTask`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

### Maintenance

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/maintenance` | All roles | Implemented | S104: maintenance reports (at most 200). |
| `POST /api/maintenance` | All roles | Implemented | S104: report a problem in a room, and optionally block the room (status MAINTENANCE_BLOCKED). An occupied room cannot be blocked. The answer lists confirmed reservations that have this room assigned. |
| `POST /api/maintenance/{id}/resolve` | Administrator, Manager | Implemented | S104: close a report as fixed. When the last blocking report of a room closes, the room is released to CLEANING and an inspection task is created. |
| `POST /api/maintenance/{id}/cancel` | Administrator, Manager | Implemented | S104: close a report that was a mistake (the room is released the same way). |

**`GET /api/maintenance`** returns 200 `MaintenanceReport[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `status` | one of OPEN, RESOLVED, CANCELLED | No |  |
| `room_id` | UUID | No |  |

**`POST /api/maintenance`** returns 201 `MaintenanceCreated`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_id` | UUID | Yes |  |
| `issue` | string | Yes | 3 to 300 characters. |
| `severity` | one of LOW, MEDIUM, HIGH | No | Default MEDIUM. |
| `block_room` | bool | No | Default false. |

**`POST /api/maintenance/{id}/resolve`** returns 200 `MaintenanceReport`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `note` | string | No | At most 300 characters. |

**`POST /api/maintenance/{id}/cancel`** returns 200 `MaintenanceReport`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `note` | string | No | At most 300 characters. |

### Settings

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/settings` | All roles | Implemented | S105: property policies: tax, check-in and check-out times, cancellation policy text, default hold minutes, room status after check-out. |
| `PATCH /api/settings` | Administrator, Manager | Implemented | S105: change policies (Administrator, Manager). A new tax rate applies to new reservations only; each folio keeps the rate it was created with. |
| `GET /api/notification-events` | Any signed-in user | Implemented | S105: the events a person can choose to be told about. |
| `GET /api/me/notification-preferences` | Any signed-in user | Implemented | S105: your choice for every event and channel. In-app is on and e-mail is off until you change it. |
| `PUT /api/me/notification-preferences` | Any signed-in user | Implemented | S105: change your choices. E-mail is recorded as QUEUED only: no mail service is connected yet. |
| `GET /api/me/notifications` | Any signed-in user | Implemented | S105: your in-app messages, newest first. |
| `POST /api/me/notifications/{id}/read` | Any signed-in user | Implemented | S105: mark one of your messages as read. |
| `GET /api/notifications/logs` | Administrator, Manager | Implemented | S105: delivery log of every notification (at most 200). |

**`PATCH /api/settings`** returns 200 `Settings`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `tax_name` | string | No | At most 30 characters, or null. |
| `tax_rate_pct` | number | No | 0 to 100, 2 decimals. |
| `check_in_time` | time | No | HH:MM. |
| `check_out_time` | time | No | HH:MM. |
| `cancellation_policy` | string | No | At most 1000 characters, or null. |
| `hold_minutes` | int | No | 1 to 60. This is also the time a guest has to pay online. |
| `post_stay_room_status` | one of CLEANING, AVAILABLE | No |  |
| `online_deposit_pct` | number | No | Share of the total paid online, above 0 up to 100. Default 100. |
| `free_cancellation_hours` | int | No | 0 to 720. Default 48. |
| `late_cancel_fee_pct` | number | No | 0 to 100. Default 100. |
| `property_name` | string | No | 2 to 120 characters. |
| `address` | string | No | At most 200 characters, or null. |
| `contact_email` | string | No | A valid e-mail address, or null. |
| `contact_phone` | string | No | At most 30 characters, or null. |
| `logo_data_url` | string | No | A PNG, JPG or WebP picture as a data URL, under 2 MB, or null to remove it. |

**`PUT /api/me/notification-preferences`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `preferences` | object[] | Yes | Each: event_code, channel (IN_APP or EMAIL), enabled (true or false). 1 to 20 items. |

**`GET /api/me/notifications`** returns 200 `InboxItem[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `unread` | bool | No | true for unread only. |

**`POST /api/me/notifications/{id}/read`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`GET /api/notifications/logs`** returns 200 `NotificationLog[]`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `event_code` | string | No |  |
| `channel` | one of IN_APP, EMAIL | No |  |
| `status` | one of QUEUED, DELIVERED, FAILED | No |  |
| `from` | date | No |  |
| `to` | date | No |  |

### Reports

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/reports/occupancy` | All roles | Implemented | S106: per day rooms occupied, occupancy % and room revenue, plus ADR and RevPAR for the period (at most 366 days). Cancelled and No-Show reservations are not counted. |
| `GET /api/reports/payments` | Administrator, Manager | Implemented | S106: payments, deposits and refunds per day and per method (at most 366 days). |
| `GET /api/reports/summary` | All roles | Implemented | S106: dashboard numbers: arrivals, departures due, in-house, room status counts, occupancy today, housekeeping, maintenance, pending refunds, bookings by source (30 days). Money figures (outstanding_balance_in_house, payments_today) are null for Front Desk. |

**`GET /api/reports/occupancy`** returns 200 `OccupancyReport`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `from` | date | Yes |  |
| `to` | date | Yes | Not before from. |

**`GET /api/reports/payments`** returns 200 `PaymentReport`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `from` | date | Yes |  |
| `to` | date | Yes | Not before from. |

### Approvals

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/approvals/summary` | Administrator; Manager only if can_approve_rates | Implemented | S134: how many requests wait for a decision, by kind (for a badge in the manager app). |
| `GET /api/approvals` | Administrator; Manager only if can_approve_rates | Implemented | S134: requests waiting for approval (new room type with its rates, rate or rate change, add-on or add-on price), oldest first; or the history of APPROVED or REJECTED decisions, newest first. Only an Administrator, or a Manager who was given the right to approve rates, may use it (S133, S142). |
| `GET /api/approvals/{kind}/{id}` | Administrator; Manager only if can_approve_rates | Implemented | S134: one request with its details and its revision. A request that was decided shows the decision. |
| `POST /api/approvals/{kind}/{id}/approve` | Administrator; Manager only if can_approve_rates | Implemented | S135: approve with the same rules as the desktop endpoints. Send the revision the manager saw: if the request changed since, the answer is STALE_REQUEST and nothing happens (S138). A request already decided is refused with INVALID_STATE and the name of the person who decided; two decisions at the same moment: one wins. |
| `POST /api/approvals/{kind}/{id}/reject` | Administrator; Manager only if can_approve_rates | Implemented | S137: reject with a reason (3 to 300 characters). The pending room type, rate or add-on is taken away; a copy stays in the decision history with who, when and why. |

**`GET /api/approvals`** returns 200 `ApprovalRequest[]`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `status` | one of PENDING, APPROVED, REJECTED | No | Default PENDING. |
| `kind` | one of ROOM_TYPE, RATE, ADD_ON | No |  |
| `limit` | int | No | 1 to 100, default 50. |

**`GET /api/approvals/{kind}/{id}`** returns 200 `ApprovalRequest`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

**`POST /api/approvals/{kind}/{id}/approve`** returns 200 `ApprovalRequest`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `BASE_RATE_EXISTS`, `INVALID_STATE`, `STALE_REQUEST`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `revision` | string | No | The revision from the detail. |

**`POST /api/approvals/{kind}/{id}/reject`** returns 200 `ApprovalRequest`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `STALE_REQUEST`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | Yes | 3 to 300 characters. |
| `revision` | string | No | The revision from the detail. |

### Booking engine

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/public/availability` | Public | Implemented | S166, S167: approved room types with approved prices (tax included) for the stay. No guest data and no stock figures: rooms_left is shown up to 5. 120 requests a minute per address. |
| `POST /api/public/bookings` | Public | Implemented | S168, S169: start a booking. The server validates the guest form, works out the price and takes a hold (the hold time of the property). The response shows access_token once: keep it. Any price in the request is refused. At most 3 unpaid bookings per e-mail address; 20 requests a minute per address. |
| `GET /api/public/bookings/{id}` | Public | Implemented | S168: the state of one booking (HOLDING, PAYMENT_PENDING, CONFIRMED, FAILED, EXPIRED, ABANDONED, PAID_UNFULFILLED). Needs the X-Booking-Token header (missing 401, wrong 404). |
| `POST /api/public/bookings/{id}/payment-session` | Public | Implemented | S170: open the payment: amount (the deposit share of the total), currency and reference are chosen by the server; whatever the client sends is ignored. Asking again returns the same open session. |
| `POST /api/public/bookings/{id}/cancel` | Public | Implemented | S173, S175: the guest leaves an unpaid booking (hold released, session closed), or cancels a confirmed one under the cancellation rule of the property (fee, refund request). |
| `POST /api/public/payments/webhook` | Public | Implemented | S171, S172, S173: result of a payment from the gateway. The raw body is signed with HMAC-SHA256 (hex) and a shared secret (env PAYMENT_WEBHOOK_SECRET) in header X-Signature. The reference, amount and currency must match the session. Each event_id is processed once (a repeat answers DUPLICATE). A success confirms the booking; a failure releases the hold; a success after the hold ended takes the room again if it is free, otherwise the booking becomes PAID_UNFULFILLED and the managers are told. The gateway message format is an assumption: the client has not named a gateway. |
| `GET /api/email-outbox` | Administrator, Manager | Implemented | S174: confirmation e-mails waiting to be sent. Nothing sends them yet: no mail service is part of the system. |

**`GET /api/public/availability`** returns 200 `PublicAvailability`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMITED`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `property_id` | UUID | No | Needed when the system has more than one property. |
| `from` | date | Yes |  |
| `to` | date | Yes |  |
| `guests` | int | No |  |
| `room_type_id` | UUID | No |  |

**`POST /api/public/bookings`** returns 201 `BookingAttempt`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `NO_APPROVED_RATE`, `NO_STOCK`, `PRICE_CHANGED`, `SOLD_OUT`, `RATE_LIMITED`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `property_id` | UUID | No |  |
| `room_type_id` | UUID | Yes |  |
| `check_in` | date | Yes |  |
| `check_out` | date | Yes |  |
| `total_guests` | int | Yes |  |
| `guest` | object | Yes | full_name, email (required), phone. |
| `special_requests` | string | No | At most 500 characters. |
| `expected_total` | number | No | The total the guest saw. If it is no longer the price: PRICE_CHANGED. |

**`GET /api/public/bookings/{id}`** returns 200 `BookingAttempt`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

| Headers | Type | Required | Notes |
|---|---|---|---|
| `X-Booking-Token` | string | Yes |  |

**`POST /api/public/bookings/{id}/payment-session`** returns 201 `PaymentSession`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `HOLD_EXPIRED`, `INVALID_STATE`.

| Headers | Type | Required | Notes |
|---|---|---|---|
| `X-Booking-Token` | string | Yes |  |

**`POST /api/public/bookings/{id}/cancel`** returns 200 `PublicCancelResult`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Headers | Type | Required | Notes |
|---|---|---|---|
| `X-Booking-Token` | string | Yes |  |

**`POST /api/public/payments/webhook`** returns 200 `WebhookResult`. Errors: `VALIDATION_ERROR`, `INVALID_SIGNATURE`, `NOT_FOUND`, `PAYMENT_MISMATCH`.

| Headers | Type | Required | Notes |
|---|---|---|---|
| `X-Signature` | string | Yes | HMAC-SHA256 (hex) of the raw body. |

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `event_id` | string | Yes | Unique per event, up to 80 characters. |
| `type` | one of payment.succeeded, payment.failed | Yes |  |
| `reference` | string | Yes |  |
| `amount` | number | No | Required for payment.succeeded. |
| `currency` | string | No | Three letters; required for payment.succeeded. |
| `transaction_id` | string | No |  |

**`GET /api/email-outbox`** returns 200 `EmailOutboxItem[]`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `status` | one of QUEUED, SENT, FAILED | No |  |

### Rooms

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/rooms` | All roles | Implemented | All rooms of my property with their floor and status. |
| `POST /api/rooms` | Administrator, Manager | Implemented | S062: add a physical room. The room number is unique ignoring upper/lower case. |
| `PATCH /api/rooms/{id}` | Administrator, Manager | Implemented | Change a room number, floor or room type. The type cannot change while the room is assigned to a confirmed or in-house reservation. |
| `DELETE /api/rooms/{id}` | Administrator, Manager | Implemented | Delete a room that has never been used for a stay. |
| `PATCH /api/rooms/{id}/status` | All roles | Implemented | Change a room status. OCCUPIED is set by check-in only. |

**`POST /api/rooms`** returns 201 `RoomCreated`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_type_id` | UUID | Yes |  |
| `room_number` | string | Yes | 1 to 10 letters, digits or hyphens. |
| `floor` | int | No | -5 to 200. |

**`PATCH /api/rooms/{id}`** returns 200 `RoomUpdated`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_number` | string | No |  |
| `floor` | int | No | null removes the floor. |
| `room_type_id` | UUID | No |  |

**`DELETE /api/rooms/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

**`PATCH /api/rooms/{id}/status`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `status` | one of AVAILABLE, CLEANING, MAINTENANCE_BLOCKED | Yes |  |

### Rates

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/rates` | All roles | Implemented | Rate rules. Front Desk sees APPROVED only; Administrator and Manager see all. |
| `POST /api/rates` | Administrator, Manager | Implemented | Create a rate rule. It starts as PENDING and has no effect until approved. |
| `POST /api/rates/{id}/approve` | Administrator; Manager only if can_approve_rates | Implemented | Approve a PENDING rate. Administrator, or a Manager whose can_approve_rates is true. Approving a change (S068) ends the rate it replaces from its effective date. |
| `POST /api/rates/{id}/revise` | Administrator, Manager | Implemented | S068: change an approved rate. The new rate waits as PENDING; the approved rate stays in force until the change is approved and its effective date arrives. |
| `DELETE /api/rates/{id}` | Administrator, Manager | Implemented | Withdraw a PENDING rate or change. An approved rate cannot be deleted. |
| `GET /api/rates/preview` | All roles | Implemented | S066: nightly price for a stay (check-out night not counted), using approved rates only. Administrator and Manager also see the other rules that matched each night and nights that tie. |

**`POST /api/rates`** returns 201 `RateCreated`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_type_id` | UUID | Yes |  |
| `rule_type` | one of BASE, DATE_RANGE, SELECTED_DAY, SPECIFIC_DATE | Yes |  |
| `rate_amount` | number | Yes | More than 0, at most 9,999,999.99, up to 2 decimals. |
| `currency_code` | string | No | If sent, must be the property currency. |
| `date_from` | date | No | DATE_RANGE only (required there). |
| `date_to` | date | No | DATE_RANGE only (required there, on or after date_from, at most 366 days). |
| `selected_days` | whole numbers | No | SELECTED_DAY only (required there): 0 = Sunday to 6 = Saturday, each once. |
| `specific_date` | date | No | SPECIFIC_DATE only (required there). |
| `priority` | int | No | 0 to 100. Higher wins (FR-17 is still to be confirmed). |

**`POST /api/rates/{id}/approve`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `BASE_RATE_EXISTS`, `INVALID_STATE`.

**`POST /api/rates/{id}/revise`** returns 201 `RateRevisionCreated`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `rate_amount` | number | Yes | The new rate, different from the current one. |
| `effective_from` | date | No | First night of the new rate, today or later. Default: the day it is approved. |
| `priority` | int | No | 0 to 100. |
| `currency_code` | string | No | If sent, must be the property currency. |

**`DELETE /api/rates/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

**`GET /api/rates/preview`** returns 200 `RatePreview`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `room_type_id` | UUID | Yes |  |
| `from` | date | Yes |  |
| `to` | date | Yes | After from, at most 90 nights. |

### Add-ons

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/add-ons` | All roles | Implemented | Add-ons. Front Desk sees approved, active add-ons only; Administrator and Manager see all, with any pending new price. |
| `POST /api/add-ons` | Administrator, Manager | Implemented | Create an add-on. It starts PENDING and cannot be charged until approved. |
| `PATCH /api/add-ons/{id}` | Administrator, Manager | Implemented | Change an add-on. On an approved add-on a new unit_price waits as pending_unit_price; the approved price stays until it is approved. |
| `POST /api/add-ons/{id}/approve` | Administrator; Manager only if can_approve_rates | Implemented | Approve a new add-on, or its pending new price. Independent of room type approval. |
| `DELETE /api/add-ons/{id}` | Administrator, Manager | Implemented | Withdraw an add-on that is still PENDING. An approved add-on is switched off with is_active=false. |

**`POST /api/add-ons`** returns 201 `AddOn`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 2 to 80 characters, unique ignoring upper/lower case. |
| `description` | string | No | Up to 300 characters. |
| `pricing_unit` | one of PER_STAY, PER_NIGHT, PER_GUEST | No | Default PER_STAY. |
| `unit_price` | number | Yes | 0 to 9,999,999.99, up to 2 decimals. |
| `is_active` | bool | No |  |

**`PATCH /api/add-ons/{id}`** returns 200 `AddOn`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | No |  |
| `description` | string | No |  |
| `pricing_unit` | one of PER_STAY, PER_NIGHT, PER_GUEST | No | Only while PENDING. |
| `unit_price` | number | No |  |
| `is_active` | bool | No |  |

**`POST /api/add-ons/{id}/approve`** returns 200 `AddOn`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

**`DELETE /api/add-ons/{id}`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

### Audit

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/audit` | Administrator, Manager | Implemented | Latest 100 audit records of my property. |

### Staff accounts

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/password-policy` | Public | Implemented | The password rules, so a form can show them. |
| `POST /api/me/password` | Any signed-in user | Implemented | Change my password. Ends my other sessions. |
| `GET /api/roles` | Administrator, Manager | Implemented | The three roles. |
| `GET /api/users` | Administrator, Manager | Implemented | Staff accounts of my property. |
| `POST /api/users` | Administrator (any role); Manager (Front Desk accounts only) | Implemented | Create a staff account. Administrator: any role. Manager: Front Desk accounts only. |
| `PATCH /api/users/{id}` | Administrator (any role); Manager (Front Desk accounts only) | Implemented | Edit an account. A Manager may only edit full_name and is_active of Front Desk accounts. Deactivating or changing a role ends that user's sessions. |
| `POST /api/users/{id}/reset-password` | Administrator (any role); Manager (Front Desk accounts only) | Implemented | Set a new password for an account (also unlocks it) and end its sessions. |
| `POST /api/users/{id}/revoke-sessions` | Administrator (any role); Manager (Front Desk accounts only) | Implemented | End every session of an account. |

**`POST /api/me/password`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `current_password` | string | Yes |  |
| `new_password` | string | Yes | Must meet the password rules. |

**`POST /api/users`** returns 201 `StaffUser`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | Yes | 2 to 120 characters. |
| `email` | string | Yes | Unique, ignoring upper/lower case. |
| `phone` | string | No | Up to 30 characters. |
| `role` | one of ADMINISTRATOR, OWNER_MANAGER, FRONT_DESK | Yes |  |
| `password` | string | Yes | Must meet the password rules. |
| `can_approve_rates` | bool | No | Administrator only; Owner/Manager accounts only. |

**`PATCH /api/users/{id}`** returns 200 `StaffUser`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | No |  |
| `phone` | string | No | Up to 30 characters; empty text removes it. |
| `role` | one of ADMINISTRATOR, OWNER_MANAGER, FRONT_DESK | No | Administrator only. |
| `can_approve_rates` | bool | No | Administrator only. |
| `is_active` | bool | No |  |

**`POST /api/users/{id}/reset-password`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `new_password` | string | Yes |  |

**`POST /api/users/{id}/revoke-sessions`** returns 200 `Revoked`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

### Web app (apps/fds-web)

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `POST /api/auth/login` | Public | Implemented | Sign in. Sets the HttpOnly session cookie; the token is not in the body. |
| `GET /api/auth/session` | Public | Implemented | Who is signed in. Answers { "user": null } (200) when nobody is, or the session ended. |
| `POST /api/auth/logout` | Public | Implemented | End this session and clear the cookie. |
| `GET /api/auth/setup` | Public | Implemented | True only while the database has no user at all. |
| `POST /api/auth/setup` | Public | Implemented | Create the first Administrator. Refused (409) once any user exists. |
| `GET /api/staff` | Administrator, Manager | Implemented | Staff accounts of my property, in the web app format. Same rules as GET /api/users. |
| `POST /api/staff` | Administrator (any role); Manager (Front Desk accounts only) | Implemented | Create a staff account. Same rules as POST /api/users. |
| `PATCH /api/staff/{id}` | Administrator (any role); Manager (Front Desk accounts only) | Implemented | Edit an account. Same rules as PATCH /api/users/{id}. status "pending" and a changed email are refused. |

**`POST /api/auth/login`** returns 200 `WebUserBox`. Errors: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `email` | string | Yes |  |
| `password` | string | Yes |  |

**`POST /api/auth/setup`** returns 201 `WebMessage`. Errors: `VALIDATION_ERROR`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes |  |
| `email` | string | Yes |  |
| `phone` | string | No |  |
| `password` | string | Yes | Must meet the password rules. |
| `confirm` | string | No | Must equal password. |

**`POST /api/staff`** returns 201 `WebUserBox`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes |  |
| `email` | string | Yes |  |
| `phone` | string | No |  |
| `role` | one of admin, manager, front_desk | Yes |  |
| `password` | string | Yes | Must meet the password rules. |

**`PATCH /api/staff/{id}`** returns 200 `WebUserBox`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `name` | string | No |  |
| `email` | string | No | Must equal the current email. |
| `phone` | string | No |  |
| `role` | one of admin, manager, front_desk | No |  |
| `status` | one of active, disabled | No |  |

## 9. Rules that are assumptions (the SRS does not set them)

Please confirm or change these in review; each one is easy to change before the front end is built.

1. **Session lifetime:** 8 hours, 60 minutes idle. **Lockout:** 5 wrong passwords, 15 minutes.
2. **Password rules (S058):** At least 10 characters (up to 128); Contains at least one letter and one number; Is not a very common password (for example "password" or "qwerty" with numbers added); Does not contain your email name or a part of your name that is 4 or more letters long.
3. **"Manager: Limited" for user management** means Front Desk accounts only (section 5).
4. **Audit log** is visible to Administrator and Manager only (the SRS matrix has no audit row).
5. **Rate precedence** (FR-17 is "to be confirmed"): higher `priority` wins; on a tie Specific Date, then Date Range, then Selected Day, then Base. Date Range includes both end dates.
6. **Changing an approved rate** (S068): the change is a new PENDING rate (`POST /api/rates/{id}/revise`). The approved rate stays in force until the change is approved and its `effective_from` night arrives (default: the day it is approved). A second approved Base Rate created the old way is still refused (`BASE_RATE_EXISTS`). Existing reservations keep the price recorded when they were made.
7. **Pagination:** only `GET /api/reservations` is paged (default 25 rows, at most 100). Other lists return at most 200 rows.
8. **Statuses** (`CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`; `UNPAID`, `PARTIAL`, `PAID`) come from the functional requirements; the SRS does not list them.
9. **The web app's wording differs:** its Staff screen says managers can manage managers, and offers status "Pending Approval". This server follows the SRS reading in item 3 (a Manager manages Front Desk accounts only) and has no pending state; both are refused with a clear message. A changed email address is also refused for now.
10. **Room types need approval before they are sold** (S067): a new room type is submitted with its rates, stays PENDING, and one approval makes the type and its pending rates live. Front Desk sees approved types only. Editing details of a room type takes effect at once; only rates need approval. The SRS only names Pending and Approved. A manager can still say no (M17, item 26): rejecting takes the pending item away and keeps a copy with the reason.
11. **Rate validation** (S063 to S065): a rate is more than 0, at most 9,999,999.99, with up to 2 decimals, in the property currency (a different `currency_code` is refused). A Date Range covers at most 366 days; `selected_days` lists each day once; `priority` is 0 to 100.
12. **Rate ties** (S066): precedence is item 5. When a new rule has the same type and priority as an approved rule on an overlapping night, the response carries a `PRIORITY_TIE` warning, and the preview lists tied nights. The rule is still created.
13. **Add-ons** (S069) are not an SRS entity; they are modelled as their own list with their own approval, separate from room types. A new price on an approved add-on waits as `pending_unit_price`. A charge from an add-on stores the price of that moment. Quantity defaults to 1 per stay, the number of nights per night, or the number of guests per guest.
14. **Rooms** (S062): room numbers are unique across the system, ignoring upper/lower case (the system serves one property). Floor is -5 to 200. A room's type cannot change while the room is assigned to a confirmed or in-house reservation, and a room that has been used for a stay cannot be deleted. Adding a room does not change room stock.
15. **Holds** (S080): a hold keeps one room of a type for a stay for 15 minutes by default (1 to 60 allowed) and counts in `room_stock.reserved_rooms` like a booking. A hold that ran out of time is given back the next time anyone searches availability or touches holds; the server does not need a timer. Confirming an expired hold returns `HOLD_EXPIRED`.
16. **Changing a CONFIRMED reservation** (S083): the new stay is priced again with the rates approved today (so the total can change), old ROOM charges are replaced and add-on and additional charges stay. Changing the room type clears the assigned room. After check-in only a later check-out and guest details can change; shortening a stay is done by checking out early.
17. **Cancel and No-Show** (S084, S085): only a CONFIRMED reservation can be cancelled or marked No-Show. The SRS gives no cancellation fee, deadline or refund rule, so none is applied; payments already taken are left as they are for staff to handle. A No-Show cannot be recorded before the arrival date. Nights before today are never returned to stock.
18. **Check-in** (S086) is refused before the arrival date and on or after the check-out date. **Check-out** (S087) needs a zero balance and returns the unused nights to stock when the guest leaves early.
19. **Charges are never edited or deleted** (S097): the database refuses it. A mistake is voided with a reason and stays visible under `voided_charges`. Editing the dates or room type of a CONFIRMED reservation voids its old room nights and records new ones. Room nights cannot be voided on their own; use a discount to waive a night.
20. **Tax and discounts** (S099): the SRS has neither. One tax rate per property (`PATCH /api/settings`) is copied onto each folio when it is created and applies to everything on the folio, after discounts. The default is 0, so nothing changes until a rate is set. A discount (percentage or fixed) is limited to Administrator and Manager and its amount is recorded when it is given. `balance` = total (charges minus discounts plus tax) minus payments received plus refunds paid out. `total_charges` now means that total.
21. **Payments and deposits** (S100): a deposit is a payment taken before or during the stay; both count towards the balance and neither can be more than the balance. An ONLINE payment needs a gateway reference. Without an Idempotency-Key or a gateway reference, two identical payments sent twice are recorded twice.
22. **Refunds** (S101): anyone who handles folios can request a refund of a completed payment; Administrator or Manager approves or rejects it, and not the person who asked. Only an approved refund changes the balance. The SRS has no refund rules, so there is no time limit and no refund to a different method.
23. **Housekeeping and maintenance** (S103, S104): check-out sets the room to the property's post-stay status (CLEANING unless changed) and creates a cleaning task; finishing the task makes the room AVAILABLE. A blocked room is released to CLEANING (not AVAILABLE) with an inspection task. Blocking a room does not change room stock; a Manager adjusts stock separately. Confirmed reservations that have the blocked room assigned are listed in the answer but are not moved.
24. **Notifications** (S105): in-app messages are stored as DELIVERED. E-mail is only logged as QUEUED because no mail service is connected (the SRS names none). The events are refund requested and decided, maintenance reported and room ready.
25. **Reports** (S106): occupancy and room revenue count CONFIRMED, CHECKED_IN and CHECKED_OUT reservations. Front Desk (operational reports) sees occupancy, room status and counts, but not payment totals. Days are in UTC+8.
26. **Approval inbox** (M17, S133 to S138): one API over room types (with their rates), rate rules and add-ons that wait for approval. Only an Administrator, or a Manager who was given the right to approve rates, may use it; Front Desk never. **Reject** takes the pending item away (a new room type, rate or add-on is deleted; a pending add-on price is cleared) and keeps a copy in the decision history with the reason, the person and the time. The desktop endpoints approve through the same code. The client sends the `revision` it saw; if the request changed, the answer is STALE_REQUEST. A request already decided is refused (INVALID_STATE) and the answer names who decided. The SRS has no manager mobile app: the API is written so any app can use it.
27. **Public booking engine** (M21, S166 to S172): no sign-in. A booking attempt takes a hold of `hold_minutes` (which is also the time to pay) and gets a private token (stored as a hash). The server prices the stay and the tax; any price sent by the client is refused. At most 3 unpaid attempts per e-mail address and 20 attempts a minute per IP address (the client has not set such limits).
28. **Payment gateway** (S170, S171): the client has not named a gateway. The webhook format (event id, type, reference, amount, currency) and the signature (HMAC-SHA256 of the raw body, header X-Signature, secret in env PAYMENT_WEBHOOK_SECRET) are assumptions and must be mapped to the real gateway. Each event is processed once. The amount, the currency and the reference must match the session the server created. The amount due online is `online_deposit_pct` of the total (default 100%).
29. **Late and failed payments** (S173, S179, S180): a failed payment releases the hold at once. A hold that ends unpaid is expired by a timer (every 30 seconds, env HOLD_SWEEP_SECONDS) and also whenever somebody searches. A payment that arrives after that still counts: if the room is free it is booked, otherwise the booking becomes PAID_UNFULFILLED and the managers are told to refund it at the gateway. The system does not call the gateway to refund.
30. **Confirmation e-mail** (S174): queued in a table (email_outbox), once per reservation. Nothing sends it: no mail service is part of the system.
31. **Cancellation and refund** (S175): free until `free_cancellation_hours` (default 48) before the check-in time; after that a fee of `late_cancel_fee_pct` (default 100) percent of the total. What the guest paid beyond the fee is asked back as refund requests that a Manager or Administrator must approve (M13). Staff and guests use the same rule. The folio is not changed by the fee: it is kept on the reservation (cancel_fee). Both are assumptions until the client decides.

## 10. Change log

| Version | Change |
|---|---|
| 0.2 | First contract: conventions, identifiers, error catalog, 25 implemented endpoints, 11 planned. |
| 0.3 | S056 and S058 built: the 11 planned endpoints (sessions, password rules and change, staff accounts) are now implemented. No field removed or renamed. |
| 0.4 | Added the web app endpoints (section 4a) and `phone` on staff accounts (migration 003). Nothing removed or renamed. |
| 0.5 | M09 (S060 to S069): room categories, room type details and approval, rooms with floors, rate validation, rate changes that wait for approval, price preview, add-ons (migration 004). New fields on existing responses: `RoomType` (category_id, photos, approval_status), `Room` (floor, room_type_id), `Rate` (room_type_id, currency_code, supersedes_id, effective_from, valid_until, in_force), `RateCreated.warnings`, charge type `ADD_ON`. Nothing removed or renamed. |
| 0.6 | M11 (S079 to S087): holds (`/api/holds`), reservation search with filters, sorting and paging, edits of dates, room type and guests, extensions, No-Show (`POST /api/reservations/{id}/no-show`), status NO_SHOW, error code `HOLD_EXPIRED`, check-in precondition on the arrival date, optional `room_id` on check-in (migration 005). New fields: `AvailabilityItem.rooms_total`, `ReservationRow` (phone, created_at), `ReservationDetail` (status_remark, status_changed_at, checked_in_at, checked_out_at). Check-in before the arrival date used to work and is now refused. |
| 0.7 | M13 (S097 to S106): folio detail, voiding, discounts and tax, payments and deposits with duplicate protection, refunds, invoice and receipt data, reconciliation, housekeeping, maintenance, settings, notifications, reports (migration 006, 35 endpoints). New fields on `ReservationDetail`: voided_charges, discounts, refunds, subtotal, discount_total, tax_rate_pct, tax_total, total_refunded; on `Charge`: stay_date, voided_at, void_reason; on `Payment`: kind, receipt_no. `total_charges` now includes discounts and tax (identical until a tax rate or discount is used). New role permissions: billing.discount, billing.refund, settings.manage, maintenance.release. Nothing removed or renamed. |
| 0.8 | M17 and M21 (S133 to S138, S166 to S175): approval inbox (`/api/approvals`, reject with reason, revision check), public booking engine (`/api/public/...`: availability, booking attempt, payment session, signed payment webhook, guest cancel), confirmation e-mail queue, cancellation rule with refund requests (migration 007, 12 endpoints). New settings: online_deposit_pct, free_cancellation_hours, late_cancel_fee_pct. New error codes: STALE_REQUEST, INVALID_SIGNATURE, PAYMENT_MISMATCH, PRICE_CHANGED, RATE_LIMITED. Cancelling a CONFIRMED reservation now creates refund requests for what was paid (after the fee). Nothing removed or renamed. |
