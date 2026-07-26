# CRM ProgrameAi

CRM de agência open source — clientes, pipeline de vendas, propostas,
projetos, contratos e financeiro. Monólito modular NestJS + React/Vite.

## Stack
- **Backend:** NestJS + Prisma (PostgreSQL)
- **Frontend:** React + Vite
- **Monorepo:** pnpm workspaces

## Setup de desenvolvimento
```bash
pnpm install
docker compose up -d            # Postgres 16 em localhost:5435
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
pnpm dev                        # api :3000/api/v1 · web :5173
```
Login inicial: `admin@crm.local` / `changeme123` (trocar).

## Autohospedagem
Ver [seção de produção](#produção-autohospedagem) — `docker compose -f docker-compose.prod.yml up -d`.
É gratuito e não exige nenhuma licença.

## Produção (autohospedagem)
```bash
cp .env.example .env            # preencha e TROQUE todos os secrets
docker compose -f docker-compose.prod.yml up -d --build
# web em http://localhost:8080 · api em http://localhost:3000/api/v1
```
As migrations são aplicadas automaticamente no boot da API.
Gere segredos fortes para `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (≥32 chars)
e senhas de banco próprias.

## Licença
Distribuído sob a **Apache License 2.0** — ver [LICENSE](./LICENSE).
Você pode usar, modificar, autohospedar e vender versões derivadas.

## Marca (Trademark)
O **código** é livre (Apache 2.0), mas os nomes **"ProgrameAi"** e
**"CRM ProgrameAi"**, o logo e a identidade visual (teal `#0E7C7B`) **não
são licenciados**. Forks e produtos derivados devem usar um nome e uma
identidade próprios e não podem sugerir afiliação ou endosso oficial.

## Contribuindo
Ver [CONTRIBUTING.md](./CONTRIBUTING.md) e o
[Código de Conduta](./.github/CODE_OF_CONDUCT.md).
Falha de segurança vai por [reporte privado](./.github/SECURITY.md), nunca em issue.
