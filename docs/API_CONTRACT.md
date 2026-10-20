# FDS API Contract (S055)

Version 0.3, October 2026. Owner: Chester (backend). Consumers: Qiwei (front end), Ivan (environment, audit events). Business rules: Eric.

This file is generated from `docs/contract.js` (the same file produces `openapi.yaml`), and a test checks that every endpoint marked *implemented* really exists in the server and that none is missing here.

**Status:** all 36 endpoints run today.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `http://localhost:3000` in development. All paths start with `/api`. |
| Format | JSON in and out, UTF-8, header `Content-Type: application/json`. |
| Authentication | `Authorization: Bearer <token>` on every call except those marked Public. |
| Versioning | None in the path. This file's version changes when a field is removed or renamed. Adding fields is not a breaking change, so ignore fields you do not know. |
| Success body | The resource itself, or an array. No wrapper object. Creating something returns 201; everything else 200. |
| Lists | A plain array, at most 200 rows, newest first. There is no pagination yet; when it is added it will use `limit` and `offset` query parameters without changing existing responses. |
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
| `ROOM_NOT_AVAILABLE` | 409 | The room is blocked, occupied, cleaning, overlapping another stay, or the wrong type. |
| `BALANCE_OUTSTANDING` | 409 | Check-out needs a zero balance. |
| `FOLIO_CLOSED` | 409 | The folio is closed or the reservation is cancelled. |
| `BASE_RATE_EXISTS` | 409 | The room type already has an approved Base Rate. |
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
| `GET /api/room-types` | All roles | Implemented | Room types of my property. |
| `GET /api/dashboard` | All roles | Implemented | Today's arrivals and departures, in-house count, room occupancy and pending rates (pending_rates is null for Front Desk). |

### Reservations

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/availability` | All roles | Implemented | Rooms left, nightly rates and total for a stay, per room type. |
| `POST /api/reservations` | All roles | Implemented | Create a reservation (also creates its folio and one ROOM charge per night). |
| `GET /api/reservations` | All roles | Implemented | List reservations (newest check-in first, at most 200). |
| `GET /api/reservations/{id}` | All roles | Implemented | One reservation with its folio: charges, payments and balance. |
| `PATCH /api/reservations/{id}` | All roles | Implemented | Edit guest contact details, notes, requests or arrival time. |
| `POST /api/reservations/{id}/cancel` | All roles | Implemented | Cancel a CONFIRMED reservation and release its stock. |

**`GET /api/availability`** returns 200 `AvailabilityItem[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `from` | date | Yes | Check-in, not in the past. |
| `to` | date | Yes | Check-out, after from. |
| `guests` | int | No | Default 1. |

**`POST /api/reservations`** returns 201 `ReservationCreated`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `NO_APPROVED_RATE`, `NO_STOCK`, `SOLD_OUT`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `guest` | object | No | New guest: full_name, phone, email, nationality, id_passport_no, address. full_name is required. |
| `guest_id` | UUID | No | Use an existing guest instead of guest. |
| `room_type_id` | UUID | Yes |  |
| `check_in` | date | Yes |  |
| `check_out` | date | Yes | Exclusive: the night of this date is not booked. |
| `total_guests` | int | Yes |  |
| `source_id` | int | No | From GET /api/sources. Default 1. |
| `estimated_arrival` | time | No |  |
| `special_requests` | string | No |  |
| `notes` | string | No |  |

**`GET /api/reservations`** returns 200 `ReservationRow[]`. Errors: `VALIDATION_ERROR`.

| Query parameters | Type | Required | Notes |
|---|---|---|---|
| `status` | one of CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED | No |  |
| `q` | string | No | Matches reference or guest name. |

**`GET /api/reservations/{id}`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`PATCH /api/reservations/{id}`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | No |  |
| `phone` | string | No |  |
| `email` | string | No |  |
| `special_requests` | string | No |  |
| `notes` | string | No |  |
| `estimated_arrival` | time | No |  |

**`POST /api/reservations/{id}/cancel`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

### Stay

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/reservations/{id}/free-rooms` | All roles | Implemented | Rooms of the booked type that are free for the stay. |
| `POST /api/reservations/{id}/assign-room` | All roles | Implemented | Assign a physical room. |
| `POST /api/reservations/{id}/check-in` | All roles | Implemented | Check in. Uses the assigned room or picks a free Available one. The room becomes OCCUPIED. |
| `POST /api/reservations/{id}/check-out` | All roles | Implemented | Check out. Needs a zero balance. The room becomes CLEANING and the folio closes. |

**`GET /api/reservations/{id}/free-rooms`** returns 200 `FreeRoom[]`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`.

**`POST /api/reservations/{id}/assign-room`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `ROOM_NOT_AVAILABLE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_id` | UUID | Yes |  |

**`POST /api/reservations/{id}/check-in`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`, `ROOM_NOT_AVAILABLE`.

**`POST /api/reservations/{id}/check-out`** returns 200 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `BALANCE_OUTSTANDING`, `INVALID_STATE`.

### Folio

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `POST /api/reservations/{id}/charges` | All roles | Implemented | Post an additional charge to the folio. |
| `POST /api/reservations/{id}/payments` | All roles | Implemented | Record a payment. Cannot be more than the balance. Updates payment_status. |

**`POST /api/reservations/{id}/charges`** returns 201 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `FOLIO_CLOSED`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `description` | string | Yes | Up to 200 characters. |
| `quantity` | number | No | Greater than 0. Default 1. |
| `unit_price` | number | Yes | 0 or more. |

**`POST /api/reservations/{id}/payments`** returns 201 `ReservationDetail`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `amount` | number | Yes | Greater than 0. |
| `method` | one of CASH, CARD, ONLINE, BANK_TRANSFER | Yes |  |

### Rooms

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/rooms` | All roles | Implemented | All rooms of my property with their status. |
| `PATCH /api/rooms/{id}/status` | All roles | Implemented | Change a room status. OCCUPIED is set by check-in only. |

**`PATCH /api/rooms/{id}/status`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `status` | one of AVAILABLE, CLEANING, MAINTENANCE_BLOCKED | Yes |  |

### Rates

| Endpoint | Who | Status | What it does |
|---|---|---|---|
| `GET /api/rates` | All roles | Implemented | Rate rules. Front Desk sees APPROVED only; Administrator and Manager see all. |
| `POST /api/rates` | Administrator, Manager | Implemented | Create a rate rule. It starts as PENDING and has no effect until approved. |
| `POST /api/rates/{id}/approve` | Administrator; Manager only if can_approve_rates | Implemented | Approve a PENDING rate. Administrator, or a Manager whose can_approve_rates is true. |

**`POST /api/rates`** returns 201 `RateCreated`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `room_type_id` | UUID | Yes |  |
| `rule_type` | one of BASE, DATE_RANGE, SELECTED_DAY, SPECIFIC_DATE | Yes |  |
| `rate_amount` | number | Yes | 0 or more. |
| `date_from` | date | No | DATE_RANGE only (required there). |
| `date_to` | date | No | DATE_RANGE only (required there, on or after date_from). |
| `selected_days` | whole numbers | No | SELECTED_DAY only (required there): 0 = Sunday to 6 = Saturday. |
| `specific_date` | date | No | SPECIFIC_DATE only (required there). |
| `priority` | int | No | Higher wins (FR-17 is still to be confirmed). |

**`POST /api/rates/{id}/approve`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `BASE_RATE_EXISTS`, `INVALID_STATE`.

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
| `role` | one of ADMINISTRATOR, OWNER_MANAGER, FRONT_DESK | Yes |  |
| `password` | string | Yes | Must meet the password rules. |
| `can_approve_rates` | bool | No | Administrator only; Owner/Manager accounts only. |

**`PATCH /api/users/{id}`** returns 200 `StaffUser`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `full_name` | string | No |  |
| `role` | one of ADMINISTRATOR, OWNER_MANAGER, FRONT_DESK | No | Administrator only. |
| `can_approve_rates` | bool | No | Administrator only. |
| `is_active` | bool | No |  |

**`POST /api/users/{id}/reset-password`** returns 200 `Ok`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

| Body fields | Type | Required | Notes |
|---|---|---|---|
| `new_password` | string | Yes |  |

**`POST /api/users/{id}/revoke-sessions`** returns 200 `Revoked`. Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

## 9. Rules that are assumptions (the SRS does not set them)

Please confirm or change these in review; each one is easy to change before the front end is built.

1. **Session lifetime:** 8 hours, 60 minutes idle. **Lockout:** 5 wrong passwords, 15 minutes.
2. **Password rules (S058):** At least 10 characters (up to 128); Contains at least one letter and one number; Is not a very common password (for example "password" or "qwerty" with numbers added); Does not contain your email name or a part of your name that is 4 or more letters long.
3. **"Manager: Limited" for user management** means Front Desk accounts only (section 5).
4. **Audit log** is visible to Administrator and Manager only (the SRS matrix has no audit row).
5. **Rate precedence** (FR-17 is "to be confirmed"): higher `priority` wins; on a tie Specific Date, then Date Range, then Selected Day, then Base. Date Range includes both end dates.
6. **A changed approved Base Rate** is refused (`BASE_RATE_EXISTS`), because the SRS does not say how a new rate replaces an approved one.
7. **No pagination yet**, lists return at most 200 rows.
8. **Statuses** (`CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`; `UNPAID`, `PARTIAL`, `PAID`) come from the functional requirements; the SRS does not list them.

## 10. Change log

| Version | Change |
|---|---|
| 0.2 | First contract: conventions, identifiers, error catalog, 25 implemented endpoints, 11 planned. |
| 0.3 | S056 and S058 built: the 11 planned endpoints (sessions, password rules and change, staff accounts) are now implemented. No field removed or renamed. |
