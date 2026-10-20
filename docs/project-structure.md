# Project structure and frontend integration

The working Frontend-WebPage code and local pricing / planner fixes are consolidated in `apps/fds-web`. There is one editable frontend source tree. The root package is an npm workspace launcher; the root Vite config is a compatibility entry for an already-running preview.

## Preserved functionality

- Booking creation, room assignment, check-in/out, housekeeping and inventory.
- Early checkout releases future planner inventory while preserving reservation history.
- Base Rate, Date Range, Selected Day and Specific Date with Prior and Remark.
- Direct pricing submission by Front Desk Staff, Admin or Manager; Manager-only approval.
- Full-width unified Room Type / Room Rate approval lists.
- Date-specific published pricing in new bookings, Room Planner and stay extensions.
- Existing reservation amounts remain unchanged when approved pricing changes.

## Integration boundaries

The original foundation directories exist but contain no implementation files in this checkout. The local `feat/project-foundation` reference has no committed tree to recover. This merge preserves and documents the intended layout instead of claiming those services are implemented.

| Application | Planned connection |
| --- | --- |
| FDS frontend | Node API for authentication, rooms, reservations, billing, housekeeping and approvals |
| Manager mobile | Same approval API, plus notification delivery; Manager role only |
| Direct booking website | Published room inventory and prices, booking creation |
| Internal staff AI | Staff help through API modules; not a customer messaging assistant |
| Node API | PostgreSQL, authorization and audit records |

`apps/api/src/modules` retains directories for auth, approvals, rates, rooms, reservations, billing, housekeeping, notifications, reports, settings and staff-help. No AI-Agent branch files were silently imported: that branch's customer-facing conversational flow needs a separate review against the internal staff-only requirement.

## Next integration steps

1. Implement the API and PostgreSQL migrations in the reserved directories.
2. Agree and version shared request / response contracts in `packages/contracts`.
3. Replace localStorage adapters with API calls one feature at a time.
4. Enforce Manager approval authorization on the server and add audit logging.
5. Connect manager notifications, booking website and internal AI to the same API.
6. Configure Hostinger deployment after service configuration is available.

## Checks

Run `npm test`, `npm run lint`, and `npm run build` at the repository root. They delegate to the FDS workspace. Optional isolated Chromium regression scripts are stored under `artifacts`; they are local verification tools, not application dependencies. They use synthetic data and do not use Brave.
