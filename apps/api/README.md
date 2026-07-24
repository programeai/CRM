# apps/api — CRM ProgrameAi (backend)

API do CRM ProgrameAi: monólito modular NestJS + Prisma (PostgreSQL).
Rotas sob o prefixo `/api/v1`.

## Rodar em desenvolvimento
```bash
pnpm --filter api start:dev     # http://localhost:3000/api/v1
```
Requer o Postgres de dev (`docker compose up -d` na raiz) e o `.env`
(`cp apps/api/.env.example apps/api/.env`).

## Prisma
```bash
pnpm --filter api prisma migrate dev    # cria/aplica migrations em dev
pnpm --filter api prisma db seed        # popula admin + estágios de pipeline
```
O schema (fonte de verdade do modelo de dados) fica em `prisma/schema.prisma`.

## Mais
- Setup completo do monorepo: [README raiz](../../README.md).
- Regras de arquitetura do backend: [CLAUDE.md](./CLAUDE.md).
- Referência de endpoints: [ENDPOINTS.md](./ENDPOINTS.md).
