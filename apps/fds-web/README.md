# FDS frontend

The React application lives here. Run `npm install` from the repository root, copy this directory's `.env.example` to `.env.local`, then run `npm run dev` from the root.

URL: http://127.0.0.1:5176/. Build: `npm run build` from root; output: `apps/fds-web/dist`.

See the root README and `docs/project-structure.md` for integration boundaries. `FIGMA-IMPLEMENTATION.md` is the original frontend coverage document and may describe earlier UI behavior; current pricing and approval behavior is documented in `docs/project-structure.md`.

## Demo login configuration

For local demo login, run this once from the repository root:

```powershell
Copy-Item apps/fds-web/.env.example apps/fds-web/.env.local
```

The tracked `.env.example` contains `VITE_DEMO_AUTH=true`. Restart `npm run dev:fds` after creating or changing the environment file. Demo credentials are `admin@hotel.local` / `DemoAdmin123!`.

`.env.local` is intentionally ignored by Git; every developer creates their own local copy. Without the flag the frontend uses the authentication API, which must run separately. `npm run dev` starts only the FDS frontend, not the API server.
