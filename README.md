# Miri Front Desk Application

React hotel workspace with booking, guest profiles, operations, room configuration, folios, reports, and account authentication.

## Temporary frontend demo login (enabled)

Email: admin@hotel.local
Password: DemoAdmin123!

This synthetic admin account is included in the page for UI testing. No backend is required in demo mode. Demo staff creation/editing also works in the browser. Demo credentials and staff records are stored as plain text in localStorage, and the demo session uses sessionStorage. This is not secure authentication; use only sample accounts and passwords.

Copy .env.example to .env.local to enable VITE_DEMO_AUTH=true. Set it to false and restart npm run dev to return to server authentication. Existing server accounts are unchanged. Demo accounts use separate miri-demo-accounts storage. The admin account is seeded only on the first demo run.

## Start in Visual Studio Code

Requires Node.js 24 (the installed version is supported).

npm install
npm run dev

Open http://127.0.0.1:5173/. In demo mode this starts React only. With VITE_DEMO_AUTH=false, it starts React and the local authentication server together. Stop any older Vite-only development terminal first if port 5173 is already in use. Ctrl+C stops both servers.

## Account setup (server authentication mode only)

1. On first launch, create the initial Admin account using your own name, email and password (10–128 characters). No default credentials are provided.
2. Sign in with email and password only. The server loads the assigned account role automatically.
3. There is no public registration page or API. Admins and managers create Front Desk Staff accounts through Staff Management → Add Staff.
4. Admins/managers open Staff Management to create accounts, edit details or disable access. Admins can manage all roles; managers cannot manage or grant Admin accounts. Users cannot change their own role/status.
5. Use Sign Out in the top-right header. Logout invalidates the server session. Sessions expire after eight hours. Disabling an account or changing its role revokes existing sessions.

Staff Management is hidden from Front Desk Staff, and its API independently rejects their requests. The sign-in form has no role selector. Permissions come exclusively from the stored account. The initial-admin setup is available once, only while the account database is empty.

## Storage and scope

Accounts and hashed session tokens are stored in the local SQLite database .data/accounts.sqlite, ignored by Git. Passwords are hashed with scrypt and a random salt. Session cookies are HttpOnly and SameSite=Strict. The local server binds to 127.0.0.1; this setup uses HTTP for local development. Deployment requires HTTPS/Secure cookies and deployment-specific origin/configuration checks.

Reservations, guest profiles, room settings and housekeeping still use browser localStorage and are shared by accounts using that browser profile. Authentication does not migrate that data to a protected multi-user database. Rate and room-publication manager approvals remain local demo workflows; only Staff Management currently has server-enforced role permissions. Password reset, email verification, MFA, and a shared business-data API remain pending.

## Main workflows

- Booking: real dates, click/drag stay selection, checkout-exclusive nights, saved-guest insertion, review and confirmation.
- Reservations: search, assign clean rooms, check in, move rooms, extend stays, cancel and check out.
- Inventory: draft/new room types, fixed room IDs, physical room editing/removal safeguards, dated blocks, rate publication.
- Folio & Billing: charges and local demo payment records. No payment processing.
- Guests, Reports, Settings: guest directory/history, date-filtered reports/CSV, property configuration.

Use sample guest and payment data. See FIGMA-IMPLEMENTATION.md for screen coverage and remaining work.

## Validation

npm run build
npm run lint
npm test

Authentication integration tests use an isolated in-memory database and temporary test accounts, never the real account database.

For production-build preview, run npm run server in one terminal and npm run preview in another. Preview uses the same /api proxy. The built frontend alone cannot authenticate without the server.

