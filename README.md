# Accommodation Platform

Shared project structure for the Front Desk System, manager mobile app, direct booking website and internal staff AI assistant.

## Structure

| Location | Responsibility | Current status |
| --- | --- | --- |
| `apps/fds-web` | React Front Desk System | Working frontend demo, including pricing and Manager approvals. Sign-in and the Staff screen use the API; other screens use demo data |
| `apps/api` | Node.js API on PostgreSQL: sign-in, roles, staff, rooms, rates, add-ons | Implemented for sign-in, roles, staff accounts and M09 (rooms, rates, approvals, add-ons). Reservation endpoints exist but the FDS screens do not use them yet. See `apps/api/README.md` |
| `apps/booking-web` | Direct booking website / booking engine | Working responsive prototype; separate demo inventory |
| `apps/manager-mobile` | Manager notifications and approvals | React Native + Expo app; local demo data |
| `packages/contracts` | Shared API contracts | Reserved. The API contract is `apps/api/docs/API_CONTRACT.md` and `apps/api/docs/openapi.yaml` |
| `packages/web-ui` | Shared web components | Reserved; current FDS components remain in the FDS app |
| `db/migrations` | PostgreSQL schema migrations | Reserved. The migrations currently live in `apps/api/migrations` (001 to 004) |
| `infra/docker` | Local service definitions | Reserved |
| `infra/nginx` | Hostinger reverse proxy configuration | Reserved |
| `docs` | Integration documentation | See `docs/project-structure.md` |
| `apps/ai-service` | Front desk assistant service (LLM understanding, fixed-text replies; read-only) | Working with the popup in `apps/fds-web`. Room and booking data not connected yet. See `apps/ai-service/README.md` |

## Install and run (frontend only, demo data)

Requires Node.js 24 and npm. From the repository root, in Command Prompt:

```
npm install
copy apps\fds-web\.env.example apps\fds-web\.env.local
npm run dev
```

Open http://127.0.0.1:5176/. All frontend source lives in `apps/fds-web/src`.

```
npm test
npm run lint
npm run build
npm run preview
```

Build output: `apps/fds-web/dist`. Preview server: http://127.0.0.1:4176/.

`npm run dev:fds` starts only the FDS frontend. Other applications will be added to the npm workspace list when their package manifests and source are available.

## Run the frontend with the backend

The API runs on port 3001, where the frontend already forwards `/api`.

Window 1, the API:

```
cd apps\api
npm install
set PORT=3001
npm start
```

With no `DATABASE_URL` the API uses a built-in PostgreSQL engine and keeps its data in `apps\api\data`. To use your own PostgreSQL server, run these before `npm start`:

```
set DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/fds
npm run migrate
npm run seed
```

Window 2, the frontend, in the repository root:

```
echo VITE_DEMO_AUTH=false> apps\fds-web\.env.local
npm run dev
```

(In PowerShell use `Set-Content apps\fds-web\.env.local "VITE_DEMO_AUTH=false"` instead of `echo`.)

Open http://127.0.0.1:5176/ and sign in with `admin@fds.test` / `Orchid-Demo-2026`. Restart `npm run dev` after changing `.env.local`. If the API uses another port, set `API_PROXY_TARGET=http://127.0.0.1:PORT` before `npm run dev`.

Other demo accounts (synthetic): `manager@fds.test` / `Lantern-Demo-2026`, `frontdesk@fds.test` / `Meadow-Demo-2026`.

To check that the frontend is really using the API, sign in with `admin@fds.test` (it exists only in the API database), then stop the API and reload: sign-in and the Staff list should fail. More checks and troubleshooting: `apps/api/README.md`.

## Run the AI assistant

In `apps\ai-service`: `npm install`, `copy .env.example .env`, put your own OpenAI key in `.env`, then `npm start` (port 3002). Run `npm run dev` in the root as usual; the assistant is the "Assistant" button at the bottom right of every page. Without a key, set `LLM_PROVIDER=rules` (English only).

## Integration status

React / Node.js / PostgreSQL / Hostinger remain the agreed stack. The frontend is connected to the API for **sign-in and the Staff screen only**. Reservations, rooms, pricing and the booking website still use demo data stored in browser localStorage; keeping the same http://127.0.0.1:5176 origin preserves existing local records. Nothing is deployed to Hostinger.

Demo mode (no API): set `VITE_DEMO_AUTH=true` (the default in `.env.example`) and sign in with `admin@hotel.local` / `DemoAdmin123!`. These are synthetic demo credentials, not production authentication. In demo mode, Staff and Admin can submit pricing changes and Manager can approve or reject them.

With the API, sign-in uses a cookie (`fds_session`) and the roles are `admin`, `manager` and `front_desk`. The API is reviewed by no teammate yet and has been tested on one PostgreSQL 16 server and the built-in engine, not on the team's own database setup.

Known differences between the frontend and the API (the team needs to decide):
- The Staff screen lets a Manager manage Managers and offers "Pending Approval". The API follows SRS Draft 2: a Manager manages Front Desk accounts only, and there is no pending status.
- A changed email address is refused by the API for now.

## Direct booking website preview

Run `npm run dev:booking` from root, then open http://127.0.0.1:5177/. The public website includes room search, room details, guest details and a pay-at-property demo confirmation. It uses its own `miri-direct-bookings` localStorage key; it does not synchronize inventory or bookings with FDS yet.

## Manager app (React Native + Expo)

Run `npm run dev:mobile` for Expo Metro (port 8081), or `npm run dev:mobile:web` for the same native components in a browser at http://localhost:5180/. The app supports Android/iOS export and retains the Manager approval UI. It still uses local demo data; no backend or push connection is configured. See `apps/manager-mobile/README.md` for device requirements. The previous Vite preview on 5178 has been replaced.

