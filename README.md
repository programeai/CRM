# CRM Solarz

Monorepo: `apps/api` (NestJS) + `apps/web` (React/Vite). Ver `SPEC.md`.

## Setup dev
```bash
pnpm install
docker compose up -d            # Postgres 16 em localhost:5432
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
pnpm --filter api start:dev     # API em http://localhost:3000/api/v1
pnpm --filter web dev           # Web em http://localhost:5173
```
Login inicial: `admin@crm.local` / `changeme123` (trocar).
