# Accommodation Front Desk System: React Frontend

React web workspace for booking, guest profiles, room operations, inventory, folios, reports and staff management. This branch contains frontend files only. Backend integration remains separate.

## Run locally

Requires Node.js 24. Open this folder in Visual Studio Code, then run in PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://127.0.0.1:5173/. The environment example enables frontend demo authentication. Restart the development server after changing it.

## Demo login

Email: `admin@hotel.local`
Password: `DemoAdmin123!`

These are synthetic demo credentials. Demo staff records and passwords use localStorage, and sessions use sessionStorage. Use sample data only. This demo does not provide production authentication.

Staff sign in without selecting a role. Admin and manager accounts manage staff. Front desk staff cannot delete guest profiles. Production requires independent backend enforcement of these frontend controls.

## Main workflows

- Real calendar dates, click or drag stay selection, checkout-exclusive nights and totals.
- Saved guest search and autofill, guest details, review and confirmation.
- Reservations, room assignment, check-in/out, cancellation, moves and extensions.
- Monthly planner, physical allocations, housekeeping and room readiness.
- Room configuration, stock blocks, local rate approval and logo upload.
- Demo folios, payment records, reports and CSV export.

Records persist in this browser. Billing does not process real payments. See FIGMA-IMPLEMENTATION.md for detailed coverage and remaining work.

## Checks

```powershell
npm run build
npm run lint
npm test
```

This branch runs frontend/shared-rule tests only. It excludes the optional local authentication server and its tests. To use server authentication later, integrate a backend implementing the `/api` contract and configure `VITE_DEMO_AUTH=false`.

Local environment files, account databases, node_modules and generated build output are excluded. `.env.example` contains demo configuration only.
