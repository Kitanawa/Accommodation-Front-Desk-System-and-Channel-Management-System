# Accommodation Platform

Shared project structure for the Front Desk System, manager mobile app, direct booking website and internal staff AI assistant.

## Structure

| Location | Responsibility | Current status |
| --- | --- | --- |
| `apps/fds-web` | React Front Desk System | Working frontend demo, including pricing and Manager approvals |
| `apps/api` | Node.js API, PostgreSQL access and internal AI integration | Reserved module directories; API implementation is not present in this checkout |
| `apps/booking-web` | Direct booking website / booking engine | Working responsive prototype; separate demo inventory |
| `apps/manager-mobile` | Manager notifications and approvals | React Native + Expo app; local demo data |
| `packages/contracts` | Shared API contracts | Reserved; no shared production contract yet |
| `packages/web-ui` | Shared web components | Reserved; current FDS components remain in the FDS app |
| `db/migrations` | PostgreSQL schema migrations | Reserved |
| `infra/docker` | Local service definitions | Reserved |
| `infra/nginx` | Hostinger reverse proxy configuration | Reserved |
| `docs` | Integration documentation | See `docs/project-structure.md` |

## Install and run

Requires Node.js 24 and npm. From the repository root:

```powershell
npm install
Copy-Item apps/fds-web/.env.example apps/fds-web/.env.local
npm run dev
```

Open http://127.0.0.1:5176/. All frontend source now lives in `apps/fds-web/src`.

```powershell
npm test
npm run lint
npm run build
npm run preview
```

Build output: `apps/fds-web/dist`. Preview server: http://127.0.0.1:4176/.

`npm run dev:fds` starts only the FDS frontend. Other applications will be added to the npm workspace list when their package manifests and source are available.

## Integration status

React / Node.js / PostgreSQL / Hostinger remain the agreed stack. This structural merge does not connect the frontend to PostgreSQL or deploy to Hostinger. Demo data persists in browser localStorage; keeping the same http://127.0.0.1:5176 origin preserves existing local records.

Demo login: `admin@hotel.local` / `DemoAdmin123!`. These are synthetic demo credentials, not production authentication. Staff and Admin can submit pricing changes; Manager can approve or reject them. Backend authorization is still required before production.

Set `VITE_DEMO_AUTH=false` in `apps/fds-web/.env.local` only after an authentication API implementing the frontend's contract is available. `/api` is proxied to http://127.0.0.1:3001 by default; override with `API_PROXY_TARGET` in the server process environment. No server or database is started by the frontend command.

## Direct booking website preview

Run `npm run dev:booking` from root, then open http://127.0.0.1:5177/. The public website includes room search, room details, guest details and a pay-at-property demo confirmation. It uses its own `miri-direct-bookings` localStorage key; it does not synchronize inventory or bookings with FDS yet.

## Manager app (React Native + Expo)

Run `npm run dev:mobile` for Expo Metro (port 8081), or `npm run dev:mobile:web` for the same native components in a browser at http://localhost:5180/. The app supports Android/iOS export and retains the Manager approval UI. It still uses local demo data; no backend or push connection is configured. See `apps/manager-mobile/README.md` for device requirements. The previous Vite preview on 5178 has been replaced.
