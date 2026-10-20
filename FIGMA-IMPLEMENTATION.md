# Figma implementation tracker

Source: https://www.figma.com/proto/iv6tfpaWbRNpX5PuF02qHd

The prototype index reports 139 screens. Stage 1 implements the main operations workflow. This tracker does not claim that all 139 screens have been implemented or inspected.

## Stage 1 — implemented

- 05 Dashboard: arrivals, departures, availability, occupancy, recent reservations, assignment and cleaning attention.
- 06 Bookings Overview / Reservations: search by guest, phone or booking ID; room type and check-in date filters; status tabs; open reservation.
- 07 Offline Room Dates: existing calendar with actual dates and click/drag selection.
- 09 Offline Guest Details: existing guest information and stay preferences.
- 10 Offline Review: existing review and confirmation.
- 12 Reservation Details: guest and stay details, room assignment and charges.
- 13 Amend Booking: edit upcoming stay dates, check inventory, recalculate charges, clear assignments.
- 14–15 Cancel Booking / Reservation Cancelled: reason, confirmation, persisted cancellation and inventory release.
- 16 Assign Room: physical room selection, full quantity, overlap/type/block checks.
- 17–18 Check In / Reservation Checked In: clean-room and date checks, persisted status.
- 23–24 Check Out / Checkout Complete: record departure and mark rooms dirty. Payment settlement is not implemented.
- 25 Room Planner: real dates, assigned reservations and maintenance blocks; open reservations from cells.
- 26 Housekeeping / Assign Cleaner: status counts, room/cleaner filters, cleaner assignment, priority, notes, cleaning status and maintenance block.

Dashboard, Reservations, Room Planner and Housekeeping were visually inspected in the supplied prototype. Reservation action forms use those screens' visual style; their exact prototype frames have not yet been inspected. Existing booking screens use the earlier supplied wireframes.

## Later stages — pending

- 01–04 Sign In, error, Forgot Password, Reset Password; real authentication requires a backend.
- 08 Availability Unavailable and 11 Inventory Conflict: current app has inline validation; dedicated prototype screens remain pending.
- 19 Room Move; 20 Extend Stay for checked-in reservations (upcoming amendment is implemented).
- 21 Checkout Balance Due; 22 Payment Checkout; 27 Folios Overview; 28 Folio Billing.
- Guests, Reports, Settings and all remaining prototype screens: inspect and inventory before implementing.
- Full 139-screen catalogue, exact visual matching, responsive visual QA, URL-based routes, backend/API, database and concurrent-staff handling.

## Validation

npm run build
npm run lint
node --test src/bookingRules.test.js

The automated rules check inventory release, physical room overlap, back-to-back stays, quantity/duplicate constraints and blocked rooms. Browser preview could not be reached by the automated browser in this session, so interactive and visual verification is still pending.

## Demo behaviour

Bookings: miri-bookings in browser localStorage. Cleaning tasks: miri-cleaning.
Physical room numbers are generated sample identifiers by room type, not real hotel inventory. Unconfigured sample rooms default to Clean. No payments are collected or marked paid. No changes have been pushed to GitHub.

## Stage 2 — implemented

- 19 Room Move: dedicated allocation/review page; same-type multi-room moves effective today; clean-room and overlap checks; earlier allocation segments, charges and move reasons retained. Vacated rooms become dirty.
- 20 Extend Stay: dedicated departure/review page for checked-in stays; assigned-room and aggregate inventory checks; approved sample rate applied to added nights; previous charges, arrival and payments retained.
- 21 Checkout Balance Due: checkout blocked until the demo folio balance is zero; folio link from Reservation Details.
- 22 Payment Checkout / 30–32 Record Payment: shared record-payment form from Reservation Details or Folio menu. Records only, without card data or actual payment processing.
- 27 Folios Overview: search, payment-status filters, balance totals and counts.
- 28 Folio Billing: room charges, additional charges, payment entries and balance summary.
- 29 Add Charge: description and amount form. Integer-cent calculations; malformed amounts and overpayments rejected.
- Planner and housekeeping use date-specific allocation history after moves.

These entries supersede Stage 1 pending notes for the same workflows. Room Move, Extend Stay and Folios Overview were visually inspected in the prototype. Detail/payment forms follow the observed design system; exact frame matching remains unverified. Different-room-type moves, future/time-specific moves, refunds, discounts, cancellation billing policies, financial audit controls and real payment reconciliation remain pending.

Validation: build, lint, and 11 automated booking/folio tests covering allocation history, dirty rooms, extension conflicts, inventory, historical payments, cent precision, settlement and overpayment. Interactive browser verification remains pending.

Try: create a stay including today, assign clean rooms, and check in. Open Move Room or Extend Stay from Reservation Details. Open Folio & Billing to add a sample charge or payment record. Checkout requires a zero demo balance.

## Stage 3 — implemented

- Guests: searchable directory; add/edit contact details, language and preferences; stay history; start a new booking prefilled from a profile.
- Explicit profile IDs link repeated stays. Older bookings retain their original guest detail snapshots. Matching names/phone/email are not automatically merged.
- Reports: Overview, Reservations, Availability and Payments; inclusive date range (up to 366 days); occupancy, prorated room charges, average nightly charge, payment totals, booking-source chart, daily occupancy chart, data tables and CSV export.
- CSV fields are quoted and spreadsheet formula prefixes escaped.
- Settings landing page: Room Types & Rooms, Stock, Rates, Property & Policies, Staff & Roles, Activity History.
- Property settings: persistent property name, city, contact details, default arrival time and demo staff display name. Workspace branding uses the saved property/staff names; default arrival is applied to newly initialized booking drafts.
- Room definitions and approved rates are view-only. Stock links to Inventory and Housekeeping. Staff view is informational. Activity shows recorded moves, extensions, charges and payment entries; it is not a complete audit log.

Guests, Reports and Settings landing screens were visually inspected in the supplied prototype. Forms and charts use the same design system; exact visual matching and interactive browser QA remain pending.

Reports use historical non-cancelled/non-no-show reservations, checkout-exclusive nights, and current sample stock. Maintenance-adjusted historical capacity and actual accounting revenue recognition are not implemented. Room charges are distributed to whole cents across all nights (including extensions); existing historical nightly prices are not separately recorded. Payment filtering uses the UTC record date, as labelled.

Validation: build and lint passed; all 18 automated rules tests passed. New tests cover guest linking, historical snapshots, checkout boundaries, exact cent allocation, partial date ranges, payment dates, invalid/leap-year ranges and CSV escaping.

Remaining stages: editable room definitions and stock with migration safeguards; rate drafts/approval; full property policies; authentication/password recovery, real staff roles and permissions; complete audit logging; remaining error/empty/loading states and prototype catalogue; shared backend/database and visual QA.

## Stage 4 — implemented

- Room Types: edit existing type name, maximum guest capacity, inclusions and physical stock count. Type IDs and order are fixed; new types, deletion, categories, facilities and room-number renaming remain pending.
- Physical Rooms: stable generated room numbers and readiness list. Raising stock appends numbers within the type; lowering stock cannot remove any room referenced by reservation allocation history or unresolved housekeeping tasks.
- Daily Inventory: seven-day date navigation, room-type filter, capacity/blocked/reserved/remaining counts. Add and release dated quantity blocks with reasons; end date is exclusive. Physical maintenance blocks and dated quantity blocks are additive.
- Stock safeguards: reject capacity reductions and blocks that overbook current or future active reservations. Housekeeping cannot mark an assigned room blocked or invalidate sellable capacity.
- Rate Approval: positive MYR base-rate draft, submit for approval, reject with reason, revise, approve and publish. Only publication updates the booking calendar's rate. Rate changes are logged on the rate page. Pending/rejected drafts do not affect published prices. This is a local demo workflow without real manager authorization.
- Calendar, dashboard availability, stay amendments and extensions account for maintenance and dated stock blocks. Existing booking totals and payment records are preserved on room/rate settings changes. Amending a booking remains an explicit repricing action; extensions use the currently published rate for added nights.
- Room configuration persists under miri-rooms in this browser; existing reservations, guest profiles and cleaning tasks are retained.

Access through Inventory or Settings → Open Rooms / Open Stock / Open Rates. Room Types and Daily Inventory designs were inspected in the prototype. The base-rate approval form follows the same design system; exact prototype matching and interactive browser QA remain pending.

Validation: build and lint passed; 25 rules tests passed, including stock reductions, stable IDs, historical room references, overlapping dated blocks, draft publication, rejection/stale rates and extension inventory.

Still pending: room-type publication approvals, new room types and physical-room CRUD, conditional/date-specific rates and precedence rules, real role-based permissions, shared database/concurrency, refunds, remaining prototype screens and full visual QA. Reports still use current physical room stock without historical maintenance deductions as labelled.

## Stage 5 — implemented

- Add Room Type page: name, category, guest capacity, initial base rate, inclusions and facilities. New types start as Draft with no physical rooms.
- Room Types management page: category, published rate, physical count and publication status; edit metadata, manage rooms and open publication review.
- Physical Rooms management page: per-type room list, Add Physical Room, Edit Physical Room (floor/notes), and Remove Room confirmation.
- Physical identifiers are explicitly stored. Legacy generated identifiers are migrated in memory without renumbering and persisted on configuration save. Stock resizing preserves existing numbers and avoids collisions with custom numbers.
- Room Type Publication page: submit, demo approve/publish, reject with reason, archive, restore as draft and publication history. Publishing requires physical rooms. Archival rejects current/future active reservations and dated blocks.
- New booking selectors hide unpublished/archived types. Confirmation checks publication again. Existing historical bookings and assigned room identifiers are retained.
- Room removals are rejected when referenced by any reservation allocation history, when housekeeping tasks are unresolved, or when stock would become overbooked.

Access: Settings → Open Rooms, or Inventory → Room Types / Physical Rooms. Pages follow the previously inspected Room Types screen and existing design system; exact visual comparison and interactive browser QA remain pending. Publication controls simulate manager actions without real authorization.

These entries supersede the Stage 4 notes about room-type creation and physical-room CRUD. Hard deletion of entire room types is intentionally replaced by archival to preserve reservation history; room numbers cannot be renamed after creation. Remaining work includes authentication/password recovery, real permissions, advanced rate rules, refunds, add-ons and outstanding prototype states.

Validation: build/lint passed and all 33 rules tests passed, including identifier migration, custom room collisions, history-safe removal, room-type publication and archival constraints.

## Authentication and Staff Management — implemented

- First-admin setup, account registration/request, sign-in with assigned role, session-check screen, session-expired handling and logout.
- User fields: full name, phone, email, password and role (Admin / Manager / Front Desk Staff).
- First account must be Admin and is active immediately; later registrations request a role and await approval.
- Staff Management list/search, Add Staff, Edit Staff and account-request review/approval. Available only to Admin/Manager in navigation and the server API.
- Managers may manage managers/front desk accounts but cannot view-edit an Admin's account through mutation APIs or grant Admin access. Admins can manage all roles. Managers can see the staff directory including admin display information.
- Account status/role changes revoke sessions. Self role/status changes are blocked. At least one active admin must remain. Logout invalidates the hashed server-side session token.
- Local Node server uses SQLite for accounts/sessions, scrypt password hashes, HttpOnly/SameSite cookies, origin/custom-header CSRF checks and attempt throttling. No default credentials or real user accounts were created during testing.
- npm run dev now starts both the auth server and Vite. The initial setup screen was opened and visually checked; complete browser sign-in interactions still require a user-created account. API sign-in/logout and permissions were tested against an isolated memory database.

Validation: build and lint passed; 33 business rules tests and 3 authentication integration scenarios passed. Auth scenarios cover bootstrap, password/role validation, pending approval, front desk denial, manager/admin boundaries, self protection, disabling/revocation, CSRF and duplicate email.

Accounts are server-backed; business records remain browser-local. Real server-enforced permissions for rate/publication actions, password recovery, shared business data and production HTTPS deployment remain pending. Staff management protection is enforced server-side.

## Authentication revision — staff-created accounts

- Removed public registration UI and the public registration endpoint.
- Sign-in now requests email/password only; any client-supplied role is ignored. The server determines role from the stored account.
- One-time Initial Admin Setup remains only while the account database is empty. It assigns Admin internally without a role selector and is disabled after creation.
- Admins/managers create Front Desk Staff accounts through Staff Management → Add Staff. Existing account records are preserved. Existing legacy pending accounts can still be reviewed by privileged staff.
- Staff permissions, manager/admin boundaries, logout/session expiry and hashed passwords remain enforced server-side.
- Validation: build, lint and all 36 tests passed. Revised integration tests verify no public registration, one-time setup closure, password-only login, privileged staff creation, and ignored role-spoofing input.

This revision supersedes the earlier registration/request-role notes.

## Temporary frontend demo admin — enabled

- Demo sign-in works without the authentication backend. Synthetic credentials are displayed on the login page: admin@hotel.local / DemoAdmin123!.
- Demo account/session API uses separate browser storage. Staff Management supports demo account creation/editing with the same visible role restrictions. This is UI simulation, not secure authentication: passwords are frontend/localStorage values and session identity is browser-controlled.
- VITE_DEMO_AUTH=true in .env.local enables this mode. npm run dev starts only Vite while enabled. Set the flag false and restart to restore real server authentication; existing server accounts are preserved.
- Build/lint and all 36 frontend/business rules tests passed, including three new backend-free demo account scenarios. The unchanged server integration tests were not rerun for this frontend-only change.

## Guest deletion permissions

Admins and managers can select a guest and choose Delete Guest, then Confirm Delete. Front Desk Staff have no delete control; deletion is also checked in the application handler and shared deletion rule. This is a frontend/demo restriction while guest storage remains local.

Deleting removes the saved contact profile from Guests and booking autofill. A minimal ID/deleted marker prevents historical booking snapshots from recreating the directory entry. Reservation and billing snapshots are retained, as the confirmation explains. Matching in-progress guest autofill is cleared. Build/lint and all 39 frontend/business tests passed, including role denial and suppression of booking-derived profiles after deletion.

## Property logo upload

Settings → Property & Policies now includes Property Logo. Admins/managers can upload PNG, JPG or WebP (maximum 2 MB), preview/change/remove it, then Save Settings. Front Desk Staff can view the logo but have no upload/remove controls; both settings-save and parent-save handlers reject unauthorized logo changes. Images are decoded, resized within 512 × 512 and re-encoded before local storage. The saved image appears in the sidebar and sign-in branding and survives refresh. This remains browser-local demo access control/storage. Build and lint passed.

## Navy / teal / warm gold theme — applied

Shared CSS theme variables now define navy #14283F, teal #0F766E, pale teal #DDF3EC, background #F4F7FB, slate #233044, muted text #64748B, borders #DCE4EC and warm gold #D9A441. Sidebar, calendar headers, actions, selections, forms, guest pages, reports, settings and authentication use the shared palette. Gold is limited to branding/details. Success, warning, error and informational badges retain distinct green/amber/red/blue colours. Cards have subtle shadows and 8px corners. No application logic changed. Build and lint passed; automated browser visual review was blocked by a local connection timeout.

## Monthly Room Planner — implemented

Room Planner now defaults to a room-type-by-day monthly inventory grid matching the supplied reference structure. It has Jan–Dec tabs, year selector, previous/next month/year, Today, room-type search and print layout. Sticky date headers and room names support scrolling across all 28–31 days. Each cell shows the current base rate and A (sellable allotment), S (booked reservation rooms), B (remaining balance). Sundays and today are highlighted; symbols indicate no allocation, fully booked and invalid negative stock. Cell selection shows counts and linked reservations. Physical Allocations remains available as a second tab, with month-long room assignment rows.

A uses current physical stock less current maintenance and dated inventory blocks. S counts non-cancelled/non-no-show reservation room nights, including checked-out historical stays; it does not imply receipt of payment. Check-out dates are excluded. Rates and stock are current settings, not historical snapshots. Navigation preserves the selected month when returning from a reservation. No reservations or assignments were changed.

Validation: build and lint passed. All 45 frontend/business tests passed, including six new calendar/inventory cases for leap years, weekday alignment, blocked stock, checkout exclusion, historical bookings, unavailable publication and invalid stock. Live visual QA remains pending.

## Room Planner visual redesign

Replaced the dense legacy-style month tabs/A-S-B layout with compact month/year controls, a segmented view switch, quieter weekend shading and larger inventory cells. Each cell prioritizes rooms left, an availability meter, booked/total counts and the current MYR rate. Full, unavailable and invalid stock remain separately labelled; today and selected cells use teal highlights. Room labels show category/capacity; selected-day details use a separate panel. Calendar calculations, booking links, physical allocations, search and printing are retained. Build and lint passed; live visual review remains pending.

## Interaction improvements

- Shared accessible native-details accordion panels for guest stay history, saved-guest autofill, reservation details and calendar guidance. Panels retain their content and support keyboard toggling.
- Deferred search input handling on Guests, guest autofill, Reservations/Housekeeping, Room Planner and Staff Management; guest-directory data and monthly inventory calculations are memoized.
- Page navigation uses React transitions and gentle entry animations; interactive controls have consistent feedback. Reduced-motion preferences disable animations.
- Staff list uses async fetch/refresh without page reloads, cancellable requests, loading skeletons, disabled controls during saves and retry-ready error messages. API requests have a 15-second timeout in server mode. Demo mode remains browser-local.
- Save success is distinguished from refresh failure; stale responses and unmounted requests are ignored. Accordion content is expanded for print styling.

Validation: production build and lint passed without warnings. These changes preserve existing business calculations and role checks. Live interaction/browser verification remains pending.
