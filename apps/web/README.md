# apps/web — CRM ProgrameAi (frontend)

UI do CRM ProgrameAi: React + Vite + Tailwind v4 + shadcn (Base UI),
React Router e TanStack Query. Consome a API em `apps/api`.

## Rodar em desenvolvimento
```bash
pnpm --filter web dev           # http://localhost:5173
```
Requer a API rodando (ver [README raiz](../../README.md)).

## Variáveis de ambiente
Copie `cp apps/web/.env.example apps/web/.env` e ajuste:

- `VITE_API_URL` — base da API (padrão `http://localhost:3000/api/v1`).
- `VITE_TURNSTILE_SITE_KEY` — site key do Cloudflare Turnstile (captcha do
  registro). Em branco desativa o captcha.

## Mais
- Setup completo do monorepo: [README raiz](../../README.md).
- Regras de arquitetura e de UI do frontend: [CLAUDE.md](./CLAUDE.md).
