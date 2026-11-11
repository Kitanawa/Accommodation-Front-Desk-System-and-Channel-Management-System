# Data Dictionary: S052 and S053 (based only on SRS Draft 2, 3 Oct, v2)

17 tables = the 17 entities listed in SRS section 5. Keys: PK = primary key, FK = foreign key.
Relationships use the format `1..1 ----> 1..n`. A parent may still have no children yet (for example a room type with no rooms), except reservations to reservation_rooms (at least one) and reservations to folios (exactly one). Tested in PostgreSQL (schema.sql).

## Relationships

```
properties        1..1 ----> 1..n  users
roles             1..1 ----> 1..n  users
properties        1..1 ----> 1..n  room_categories
room_categories   1..1 ----> 1..n  room_types
room_types        1..1 ----> 1..n  rooms
room_statuses     1..1 ----> 1..n  rooms
room_types        1..1 ----> 1..n  room_stock
room_types        1..1 ----> 1..n  rate_rules
properties        1..1 ----> 1..n  reservations
guests            1..1 ----> 1..n  reservations
booking_sources   1..1 ----> 1..n  reservations
reservations      1..1 ----> 1..n  reservation_rooms
room_types        1..1 ----> 1..n  reservation_rooms
rooms             1..1 ----> 1..n  reservation_rooms   (room assigned later)
reservations      1..1 ----> 1..1  folios
folios            1..1 ----> 1..n  charges
folios            1..1 ----> 1..n  payments
users             1..1 ----> 1..n  audit_records       (null for system / guest actions)
```

## S052 tables

### properties (SRS 1, 5)
| Column | Type | Key | Example |
|---|---|---|---|
| property_id | uuid | PK | 3f2a9c10-... |
| name | varchar(120) | | Harbour View Hotel |
| address | text | | 12 Jalan Main, Kuching |
| currency_code | char(3) | | MYR |
| created_at | timestamptz | | 2026-10-15 09:00 |

### roles (SRS 4)
| Column | Type | Key | Example |
|---|---|---|---|
| role_id | smallint | PK | 2 |
| name | varchar(30) | | OWNER_MANAGER |

Values: ADMINISTRATOR, OWNER_MANAGER, FRONT_DESK. The privilege matrix itself is enforced in code.

### users (FR-01)
| Column | Type | Key | Example |
|---|---|---|---|
| user_id | uuid | PK | 8b1c4e22-... |
| property_id | uuid | FK | 3f2a9c10-... |
| role_id | smallint | FK | 2 |
| full_name | varchar(120) | | Staff A |
| email | varchar(160) | | staff.a@example.test |
| password_hash | varchar(255) | | $argon2id$v=19$... |
| can_approve_rates | boolean | | true |
| created_at | timestamptz | | 2026-10-15 09:00 |

Email is unique. `can_approve_rates` implements "Approve rates: Configurable" for Owner/Manager (SRS 4).

### room_statuses (SRS 12)
| Column | Type | Key | Example |
|---|---|---|---|
| status_id | smallint | PK | 1 |
| code | varchar(30) | | AVAILABLE |

Values: AVAILABLE, OCCUPIED, CLEANING, MAINTENANCE_BLOCKED.

### booking_sources (SRS 12, FR-04)
| Column | Type | Key | Example |
|---|---|---|---|
| source_id | smallint | PK | 1 |
| code | varchar(30) | | WALK_IN |
| name | varchar(60) | | Walk-in |

Values: WALK_IN, PHONE, EMAIL, WEBSITE, TRAVEL_AGENT, OTA.

### room_categories (FR-13)
| Column | Type | Key | Example |
|---|---|---|---|
| category_id | uuid | PK | c1010000-... |
| property_id | uuid | FK | 3f2a9c10-... |
| name | varchar(80) | | Deluxe |

### room_types (FR-13, SRS 11)
| Column | Type | Key | Example |
|---|---|---|---|
| room_type_id | uuid | PK | a0010000-... |
| category_id | uuid | FK | c1010000-... |
| name | varchar(100) | | Deluxe King |
| max_guests | smallint | | 3 |
| min_nights | smallint | | 1 |
| description | text | | 32 sqm, city view |
| facilities | jsonb | | ["WiFi","Air-con"] |
| photos | jsonb | | [{"url":"/img/dk1.jpg"}] |
| layout_info | text | | 1 king bed, balcony |

### rooms: Physical Room (SRS 5, FR-08)
| Column | Type | Key | Example |
|---|---|---|---|
| room_id | uuid | PK | d3050000-... |
| room_type_id | uuid | FK | a0010000-... |
| status_id | smallint | FK | 1 |
| room_number | varchar(10) | | 305 |

Room number is unique.

### room_stock: Room Stock / Inventory (FR-14, FR-18, SRS 12)
| Column | Type | Key | Example |
|---|---|---|---|
| stock_id | uuid | PK | e4010000-... |
| room_type_id | uuid | FK | a0010000-... |
| stock_date | date | | 2026-11-01 |
| total_rooms | smallint | | 10 |
| reserved_rooms | smallint | | 4 |

One row per room type per night. (room_type_id, stock_date) is unique. CHECK `reserved_rooms <= total_rooms` (SRS 12: never consume more inventory than available for every night).

### guests (FR-12, SRS 10 Guest Details)
| Column | Type | Key | Example |
|---|---|---|---|
| guest_id | uuid | PK | 91050000-... |
| full_name | varchar(120) | | Guest One |
| phone | varchar(30) | | +60 12-000 0000 |
| email | varchar(160) | | guest.one@example.test |
| nationality | varchar(60) | | Malaysian |
| id_passport_no | varchar(40) | | X1234567 |
| address | text | | 1 Sample Road |
| created_at | timestamptz | | 2026-10-15 09:10 |

ID/passport is only required where the property requires it (SRS 10).

### reservations (FR-04 to FR-07, SRS 12)
| Column | Type | Key | Example |
|---|---|---|---|
| reservation_id | uuid | PK | b7010000-... |
| reservation_ref | varchar(20) | | R-0001 |
| property_id | uuid | FK | 3f2a9c10-... |
| guest_id | uuid | FK | 91050000-... |
| source_id | smallint | FK | 1 |
| check_in_date | date | | 2026-11-01 |
| check_out_date | date | | 2026-11-03 |
| estimated_arrival | time | | 15:00 |
| total_guests | smallint | | 2 |
| status | varchar(15) | | CONFIRMED |
| payment_status | varchar(10) | | UNPAID |
| special_requests | text | | Late arrival |
| notes | text | | |
| created_at | timestamptz | | 2026-10-15 09:15 |

`check_out_date` is exclusive and must be after `check_in_date`. Reservation status and payment status are two separate controlled values (SRS 12). Status values: CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED. Payment status values: UNPAID, PARTIAL, PAID.

### reservation_rooms: Reservation Room (SRS 5, FR-06, FR-08)
| Column | Type | Key | Example |
|---|---|---|---|
| reservation_room_id | uuid | PK | 77010000-... |
| reservation_id | uuid | FK | b7010000-... |
| room_type_id | uuid | FK | a0010000-... |
| room_id | uuid | FK (nullable) | d3050000-... |
| rate_total | numeric(12,2) | | 400.00 |

`room_id` stays empty until assignment, which may happen before arrival or at check-in (FR-08).

### folios (FR-10, FR-20)
| Column | Type | Key | Example |
|---|---|---|---|
| folio_id | uuid | PK | f8010000-... |
| reservation_id | uuid | FK | b7010000-... |
| currency_code | char(3) | | MYR |
| opened_at | timestamptz | | 2026-10-15 09:15 |
| closed_at | timestamptz | | NULL |

One folio per reservation (`reservation_id` is unique).

### charges: Charge (FR-20)
| Column | Type | Key | Example |
|---|---|---|---|
| charge_id | uuid | PK | c8010000-... |
| folio_id | uuid | FK | f8010000-... |
| charge_type | varchar(10) | | ROOM |
| description | varchar(200) | | Room night 2026-11-01 |
| quantity | numeric(8,2) | | 1 |
| unit_price | numeric(12,2) | | 200.00 |
| amount | numeric(12,2) | | 200.00 |
| charged_at | timestamptz | | 2026-11-01 15:10 |

Values for `charge_type`: ROOM, ADDITIONAL.

### payments: Payment (FR-20, SRS 13.4)
| Column | Type | Key | Example |
|---|---|---|---|
| payment_id | uuid | PK | 99010000-... |
| folio_id | uuid | FK | f8010000-... |
| amount | numeric(12,2) | | 100.00 |
| currency_code | char(3) | | MYR |
| method | varchar(20) | | ONLINE |
| status | varchar(10) | | COMPLETED |
| gateway_reference | varchar(80) | | GW-1 |
| paid_at | timestamptz | | 2026-10-15 09:20 |

Partial and full payments are several rows. `gateway_reference` is unique when present, which blocks duplicate processing (SRS 13.4). Status values: PENDING, COMPLETED, FAILED.

## S053 tables

### rate_rules: Rate Rule (FR-15, FR-16, FR-17, SRS 11)
| Column | Type | Key | Example |
|---|---|---|---|
| rate_rule_id | uuid | PK | 12010000-... |
| room_type_id | uuid | FK | a0010000-... |
| rule_type | varchar(20) | | DATE_RANGE |
| rate_amount | numeric(12,2) | | 260.00 |
| date_from | date | | 2026-12-20 |
| date_to | date | | 2027-01-03 |
| selected_days | smallint[] | | {5,6} |
| specific_date | date | | NULL |
| priority | smallint | | 2 |
| approval_status | varchar(10) | | APPROVED |
| created_at | timestamptz | | 2026-10-18 10:00 |

- `rule_type`: BASE, DATE_RANGE, SELECTED_DAY, SPECIFIC_DATE. A CHECK constraint ensures only the columns for that type are filled.
- `selected_days`: 0 = Sunday to 6 = Saturday.
- `approval_status`: PENDING or APPROVED (FR-16). Only APPROVED rows are shown to FDS and the booking engine.
- Only one APPROVED BASE rate per room type (Base Rate is the default, SRS 11).

### audit_records: Audit Record (FR-22)
| Column | Type | Key | Example |
|---|---|---|---|
| audit_id | bigint | PK | 10452 |
| user_id | uuid | FK (nullable) | 8b1c4e22-... |
| action | varchar(40) | | RATE_APPROVED |
| entity_type | varchar(40) | | rate_rules |
| entity_id | uuid | | 12010000-... |
| old_values | jsonb | | {"approval_status":"PENDING"} |
| new_values | jsonb | | {"approval_status":"APPROVED"} |
| created_at | timestamptz | | 2026-10-19 14:20 |

Covers administrative, reservation, rate and payment changes. Make it append-only by granting no UPDATE or DELETE.

## Things the SRS does not define (my choices, flagged)

| # | Gap | What I did | Needs |
|---|---|---|---|
| 1 | Rate precedence and number of tiers are "to be confirmed" (FR-17, SRS 11) | `priority` is a plain number, nullable | Stakeholder decision |
| 2 | Reservation status and payment status values are not listed | Derived from FR-04, 07, 09, 11 and FR-20 | Confirm the lists |
| 3 | How a changed rate stays published while the change is Pending | Not modelled; one row has one status | Decide: in-place edit or new row |
| 4 | "Approve rates: Configurable" for Manager | `users.can_approve_rates` boolean | Confirm mechanism |
| 5 | When the folio is created (flow says after check-in, SRS 10 shows Booking Details / Folio and payment info at confirmation) | One folio per reservation, created with it | Confirm |
| 6 | Where the quoted room price is kept (FR-05 says store rate) | `reservation_rooms.rate_total`; nightly ROOM charges go in `charges` | Confirm |
| 7 | Session handling and token storage (FR-01) | Not in the ERD | Backend design |
| 8 | Housekeeping role, No-Show, add-on approval, rejection reason | Not in the SRS, so left out | Add only if the SRS is updated |
