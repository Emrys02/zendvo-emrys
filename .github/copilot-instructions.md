# Zendvo AI Agent Guidance

- This repo is an NPM monorepo with two main workspaces: `web/` and `backend/`.
- `web/` is a Next.js 16 App Router frontend. `backend/` is a TypeScript Express server with Drizzle ORM and a custom adapter for `NextRequest`/`NextResponse` handlers.

## Key workflows

- Install dependencies from repo root with `pnpm install`.
- Start both workspaces together: `npm run dev`.
- Start only one workspace:
  - `npm run dev:web`
  - `npm run dev:backend`
- Build:
  - `npm run build` (frontend build only in this repo config)
  - `npm run build:web`
  - `npm run build:backend`
- Tests:
  - `npm run test` runs backend Jest tests.
- Database:
  - `npm run db:migrate`
  - `npm run db:push`
  - `npm run db:check`

## Backend conventions

- The backend entrypoint is `backend/src/server.ts`.
- `backend/src/routes.ts` maps Express routes to handler exports in `backend/src/api/.../route.ts`.
- Route modules export named HTTP handlers such as `GET`, `POST`, `PUT`, `DELETE`.
- `backend/src/adapter.ts` converts Express `req/res` into `NextRequest`/`NextResponse` so route files can use Next-style request handling.
- Do not assume backend API code runs in a native Next.js server; it is still served by Express via the adapter.
- Sensitive auth flows and session logic are centralized under `backend/src/api/auth/`.
- File uploads are limited by `limitUploadSize` in `backend/src/routes.ts` (10MB max).

## Database and migrations

- Database schema is managed with Drizzle.
- `backend/drizzle/` contains Drizzle metadata.
- `backend/migrations/` stores SQL migration scripts.
- `backend/src/instrumentation.ts` checks migration status on startup and can stop the server when `STRICT_MIGRATION_CHECK=true`.

## Frontend conventions

- UI lives under `web/src/app/`, `web/src/components/`, `web/src/context/`, and `web/src/hooks/`.
- `web/src/services/` contains client API and auth fetch helpers.
- `web/src/proxy.ts` rewrites some auth/API routes and guards client navigation.

## Coding guidance

- Prefer existing folder structure and naming patterns.
- Add new backend API endpoints by creating a `route.ts` under `backend/src/api/...` and then registering the handler in `backend/src/routes.ts`.
- Use the backend `@/` alias for imports inside `backend/` files.
- Preserve backend response shape and status handling from existing APIs when extending auth, gift, or wallet routes.
- When touching database migrations, keep local migration metadata in sync with applied DB state.

## What matters most

- Keep backend route handler semantics aligned with `NextRequest`/`NextResponse` even though Express is the runtime.
- Respect the backend startup instrumented migration check.
- Route registration in `backend/src/routes.ts` is the source of truth for available backend endpoints.

Please review this guidance and tell me if any area feels incomplete or if you want more detail on the Solidity/Rust contract integration or frontend auth proxy behavior.
