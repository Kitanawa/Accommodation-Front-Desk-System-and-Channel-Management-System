# Evidence for S052 to S058 (for the Excel sheet)

Paste each work note into column P of the Subtask sheet. Do not set Progress to 100% or enter a Completed date until the reviews below have happened. Estimated and logged hours are yours to fill in. Nothing here has been reviewed by a teammate.

Automated checks: `npm test` runs 281 checks in 9 files, all passing, on the embedded PostgreSQL engine (PGlite). They have not been run against a full PostgreSQL server.

## S052 ERD
> ERD of the 17 SRS section 5 entities, relationships as 1..1 ----> 1..n, Mermaid + PNG + review workbook, based on SRS Draft 2 only. Pending: teammate review.

Files: `erd/` (Mermaid, PNG, workbook, data dictionary). The schema in `erd/FDS_schema_SRS_only.sql` was loaded into PostgreSQL earlier.

## S053 Approval, pricing and audit tables
> rate_rules (4 rule types, PENDING/APPROVED, CHECK per type, one approved BASE per room type) and audit_records; Manager approval via users.can_approve_rates. Pending: Eric confirms rate precedence (FR-17) and how a changed approved rate is handled.

Files: `erd/Data_Dictionary_S052_S053_SRS_only.md` (section "S053 tables" and the flagged gaps).

## S054 Migrations and anonymous seed fixtures
> Migrations 001_init and 002_auth with down scripts, runner, anonymous fixtures. 51 checks pass (`test/01`, `test/02`). Pending: Ivan runs it against a real DATABASE_URL.

## S055 API contracts, identifiers and response errors
> API contract v0.3: UUIDs, one error shape with 19 codes, role matrix, 36 endpoints, OpenAPI validates, drift test. Checks: `test/03`, `04`, `05`, `06` (98). Pending: Qiwei confirms he can build against it; Eric confirms section 9.

## S056 Authentication, password hashing, session revocation
> Login with scrypt hashing (N=32768, auto-upgrade), random tokens stored only as SHA-256, 8 h lifetime and 60 min idle, lockout after 5 wrong passwords for 15 min, list / end / end-others sessions, immediate effect of deactivation and role change. 31 checks in `test/07_auth_s056.js`. Pending: Eric confirms session settings.

## S057 Server-side role and property access checks
> SRS section 4 matrix in `permissions.js`, enforced on every endpoint; Manager rate approval follows can_approve_rates; other properties return 404. `test/08_roles_s057.js` calls every permission-gated endpoint as each role (all calls match the matrix), plus no-token and forged-token checks, and `test/06` for property scope. Pending: Eric confirms "Manager: Limited" means Front Desk accounts only.

## S058 Staff account creation and password validation
> Create / edit / deactivate / reset staff accounts with role limits (Manager manages Front Desk only), field-level validation, duplicate email check ignoring case, last-Administrator and self protection, password policy (10 to 128 chars, letter + number, not common, not own name or email) with public policy endpoint, change own password. 80 checks in `test/09_staff_s058.js`. Pending: Eric confirms the password policy (SRS sets none).

## What is not done and is not claimed
- No teammate has reviewed anything. No hours are logged.
- No front end. All tests call the API directly.
- Not run on a full PostgreSQL server, only the embedded engine.
- The ERD and workbook do not yet include `user_sessions` and the five new `users` columns.
- Sessions are a database table, not signed tokens; the SRS does not say which it wants.
