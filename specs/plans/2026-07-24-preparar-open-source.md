---
date: 2026-07-24T00:00:00-03:00
author: claude
source_prd: standalone
git_commit: 5c0b82a2ec57c27e3ba9ca35eb84121a95494139
branch: main
status: implemented
tags: [spec, open-source, license, trademark, docker, self-host]
---

# Spec: Preparar o CRM para ser Open Source

## Overview

Tornar o repositório público sob licença permissiva (Apache 2.0), permitindo que qualquer pessoa autohospede gratuitamente ou crie versões derivadas — inclusive comerciais. A monetização não vem do código: o owner venderá uma versão **SaaS hospedada** (assinatura via Stripe — ver spec de billing). Portanto, esta spec **não** introduz nenhum mecanismo de licença/DRM; o código nasce 100% livre.

A única proteção retida é a **marca**: a licença de código (Apache 2.0) não licencia nome nem logo. A marca de produto é **"ProgrameAi" / "CRM ProgrameAi"** (identidade teal `#0E7C7B`). Forks são livres, mas devem se renomear — isso é declarado numa seção de Trademark no README, não na licença.

A auditoria de segredos já foi executada: **o repo está limpo** (nenhum segredo real no working tree nem no histórico, nenhum `.env` real jamais commitado). Não é necessária reescrita de histórico. Esta spec cobre alinhamento de marca, licença, documentação e empacotamento para autohospedagem.

## Current State

- Não existe `LICENSE` em lugar nenhum.
- Duas grafias de marca convivem: UI/apresentação usam "CRM ProgrameAi"; `README.md`, `CLAUDE.md`, `ROADMAP.md`, `MAIL_FROM` e um `User-Agent` usam "CRM Solarz"/`solarz.com.br`.
- `README.md` raiz é enxuto (só setup dev) e tem uma inconsistência de porta (texto diz `5432`, o `docker-compose.yml` mapeia `5435`).
- `apps/web/README.md` e `apps/api/README.md` são boilerplate (templates Vite e NestJS).
- Não há Dockerfile para `api` nem `web`, nem qualquer caminho de deploy/autohospedagem — o `docker-compose.yml` sobe apenas Postgres 16 para dev.

## Desired End State

- `LICENSE` (Apache 2.0) e `NOTICE` na raiz.
- README raiz reescrito: descrição do produto, setup dev correto, seção de **autohospedagem** (docker), seção de **licença**, seção de **trademark**, seção de **contribuição**. READMEs boilerplate de `web`/`api` substituídos por conteúdo próprio enxuto.
- Marca alinhada para **ProgrameAi** em todos os textos versionados; referências ao domínio proprietário (`solarz.com.br`) nos **exemplos** trocadas por genéricas (o `.env` real de produção, fora do git, mantém o domínio verdadeiro).
- Autohospedagem funcional: `Dockerfile` para `api` e `web`, um `docker-compose.prod.yml` que sobe app + banco, `.env.example` de produção consolidado, e passo-a-passo no README. `docker compose -f docker-compose.prod.yml up` sobe o CRM completo.

## What We're NOT Doing

- **Sem license key, DRM ou "phone home".** Autohospedagem é irrestrita e gratuita — essa é a decisão de produto.
- **Sem reescrita de histórico git** (BFG/filter-repo). A auditoria confirmou que é desnecessário.
- **Sem renomear pacotes internos** (`name: "api"`, `name: "web"` no `package.json`) nem o diretório do repo — fora de escopo, sem impacto público.
- **Sem tocar nos documentos históricos em `specs/`** que citam "Solarz" — são registros internos, não texto público de produto.
- **Sem CI/CD de deploy** (GitHub Actions de publicação de imagem, etc.) — pode ser uma spec futura.
- **Sem billing/Stripe** — coberto pela spec `2026-07-24-billing-stripe.md`.

---

## Phase 1: Alinhamento de marca e higiene de exemplos

### Goal
Unificar a grafia da marca para "ProgrameAi" e remover o domínio proprietário dos arquivos de exemplo, deixando tudo consistente antes de o código ficar público.

### Changes

#### Documentos raiz

**Modify**: `CLAUDE.md`
Trocar o título da linha 1.
```markdown
# CRM ProgrameAi — Instruções do projeto
```

**Modify**: `ROADMAP.md`
Trocar o título da linha 1.
```markdown
# Roadmap — CRM ProgrameAi
```

> Observação: o corpo de `CLAUDE.md`/`ROADMAP.md` que porventura cite "Solarz" em prosa deve ser trocado para "ProgrameAi" na mesma passada. Manter menções a `solarz.com.br` apenas onde descrevem a empresa mantenedora real, se houver — na dúvida, genericizar.

#### Exemplos de ambiente

**Modify**: `apps/api/.env.example` (linha 40)
Remover o domínio proprietário do exemplo.
```dotenv
MAIL_FROM="CRM ProgrameAi <no-reply@example.com>"
```

#### Código com marca embutida

**Modify**: `apps/api/src/modules/auth/oauth/oauth.service.ts` (linha ~143)
Trocar o `User-Agent` legado.
```typescript
'User-Agent': 'crm-programeai',
```

> Verificar (grep `crm-solarz`, `CRM Solarz`, `solarz.com.br` sobre `git ls-files`, **exceto** `specs/`) se restou alguma outra ocorrência em código/config versionado e alinhar. `apps/api/src/mail/mail.service.ts` já usa "CRM ProgrameAi" — não mexer.

### Success Criteria

#### Automated Verification
- [x] `git grep -n "CRM Solarz" -- ':!specs/'` — retorna vazio
- [x] `git grep -n "crm-solarz" -- ':!specs/'` — retorna vazio
- [x] `git grep -n "solarz.com.br" -- ':!specs/'` — retorna vazio
- [x] `pnpm --filter api build` — compila sem erro após a troca do `User-Agent`

#### Manual Verification
- [ ] Título e prosa de `CLAUDE.md` e `ROADMAP.md` leem "ProgrameAi"
- [ ] `MAIL_FROM` no `.env.example` não expõe domínio real

**⏸ PAUSE**: Após a verificação automatizada passar, parar para confirmação humana antes da Phase 2.

---

## Phase 2: Licença Apache 2.0, NOTICE e documentação

### Goal
Adicionar a licença permissiva, o arquivo NOTICE e reescrever a documentação pública com seções de autohospedagem, licença, trademark e contribuição.

### Changes

#### Licença

**Create**: `LICENSE`
Texto **integral e inalterado** da Apache License 2.0 (o texto canônico de https://www.apache.org/licenses/LICENSE-2.0.txt). Não editar o corpo da licença — apenas colar o texto padrão.

**Create**: `NOTICE`
Arquivo NOTICE previsto pela Apache 2.0, com aviso de copyright e de marca.
```
CRM ProgrameAi
Copyright 2026 ProgrameAi

Este produto inclui software desenvolvido pela comunidade ProgrameAi.

"ProgrameAi" e "CRM ProgrameAi" são marcas do mantenedor do projeto.
O uso da marca é regido pela seção "Marca (Trademark)" do README e NÃO é
licenciado pela Apache License 2.0. Forks e versões derivadas devem adotar
um nome e identidade visual próprios.
```

#### README raiz

**Modify**: `README.md`
Reescrever completo. Corrigir a porta para `5435`, descrever o produto e adicionar as seções novas. Estrutura:
```markdown
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

## Licença
Distribuído sob a **Apache License 2.0** — ver [LICENSE](./LICENSE).
Você pode usar, modificar, autohospedar e vender versões derivadas.

## Marca (Trademark)
O **código** é livre (Apache 2.0), mas os nomes **"ProgrameAi"** e
**"CRM ProgrameAi"**, o logo e a identidade visual (teal `#0E7C7B`) **não
são licenciados**. Forks e produtos derivados devem usar um nome e uma
identidade próprios e não podem sugerir afiliação ou endosso oficial.

## Contribuindo
Ver [CONTRIBUTING.md](./CONTRIBUTING.md).
```
(A seção "Produção (autohospedagem)" detalhada é adicionada na Phase 3.)

**Create**: `CONTRIBUTING.md`
Guia curto em pt-BR: como rodar o projeto, padrão de commits (referência à skill `commit`: `tipo(escopo) descrição no imperativo`), regra de mensagens em pt-BR (link para `CLAUDE.md`), e nota de que PRs concordam em licenciar sob Apache 2.0.

#### READMEs dos apps

**Modify**: `apps/web/README.md`
Substituir o boilerplate Vite por um README enxuto: o que é o app web, como rodar (`pnpm --filter web dev`), variáveis (`VITE_API_URL`, `VITE_TURNSTILE_SITE_KEY`), link para o README raiz.

**Modify**: `apps/api/README.md`
Substituir o boilerplate NestJS por um README enxuto: o que é a API, como rodar (`pnpm --filter api start:dev`), Prisma (`migrate`/`seed`), link para `apps/api/CLAUDE.md` e `apps/api/ENDPOINTS.md`.

### Success Criteria

#### Automated Verification
- [x] `test -f LICENSE && test -f NOTICE && test -f CONTRIBUTING.md` — os três existem
- [x] `head -1 LICENSE | grep -q "Apache License"` — LICENSE é a Apache
- [x] `grep -q "5435" README.md && ! grep -q "localhost:5432" README.md` — porta corrigida
- [x] `grep -qi "Trademark" README.md` — seção de marca presente

#### Manual Verification
- [ ] README raiz descreve produto, dev, autohospedagem, licença, trademark e contribuição
- [ ] READMEs de `web` e `api` não têm mais texto de boilerplate
- [ ] Texto da Apache 2.0 está íntegro (não editado)

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 3.

---

## Phase 3: Empacotamento para autohospedagem

### Goal
Permitir que qualquer pessoa suba o CRM completo (app + banco) com um comando, sem depender do ambiente de dev.

### Changes

#### Dockerfile da API

**Create**: `apps/api/Dockerfile`
Multi-stage: build com pnpm + `prisma generate`, runtime enxuto. Aplica migrations no boot (`prisma migrate deploy`) e sobe a API.
```dockerfile
# build
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter api --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter api prisma generate && pnpm --filter api build

# runtime
FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter api prisma migrate deploy && node apps/api/dist/main.js"]
```
> Confirmar o caminho real do entrypoint compilado (`apps/api/dist/main.js` vs `apps/api/dist/src/main.js`) inspecionando o `tsconfig`/`nest-cli.json` antes de fixar o `CMD`.

#### Dockerfile do Web

**Create**: `apps/web/Dockerfile`
Build estático Vite servido por nginx. `VITE_API_URL` é injetado no build.
```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter web --frozen-lockfile
COPY apps/web apps/web
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter web build

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Create**: `apps/web/nginx.conf`
Config SPA (fallback para `index.html`).
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  location / { try_files $uri $uri/ /index.html; }
}
```

#### Compose de produção

**Create**: `docker-compose.prod.yml`
Sobe `postgres` + `api` + `web`. Sem portas de dev; secrets via `.env` na raiz.
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
    ports: ["3000:3000"]
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args: { VITE_API_URL: ${VITE_API_URL} }
    depends_on: [api]
    ports: ["8080:80"]
volumes:
  postgres_data:
```

**Create**: `.env.example` (raiz)
Consolida as variáveis de produção necessárias para o compose (banco + as que a API exige do `apps/api/.env.example`, agora servidas pelo `env_file`). Documentar em pt-BR e instruir troca de todos os secrets. **Não** conterá valores reais.

> Nota: a API lê `.env` de `apps/api/.env` hoje via `@nestjs/config`. Confirmar se `ConfigModule.forRoot` usa `envFilePath` custom; no container as variáveis chegam pelo ambiente (`env_file`), então o `ConfigModule` deve ler de `process.env` (comportamento padrão do `@nestjs/config` quando a var já existe no ambiente). Ajustar `envFilePath` se necessário para não exigir um arquivo físico.

#### Documentação de produção

**Modify**: `README.md`
Adicionar a seção `## Produção (autohospedagem)` com o passo-a-passo:
```markdown
## Produção (autohospedagem)
```bash
cp .env.example .env            # preencha e TROQUE todos os secrets
docker compose -f docker-compose.prod.yml up -d --build
# web em http://localhost:8080 · api em http://localhost:3000/api/v1
```
As migrations são aplicadas automaticamente no boot da API.
Gere segredos fortes para `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (≥32 chars)
e senhas de banco próprias.
```

**Modify**: `.gitignore`
Garantir que o `.env` da raiz (novo) está coberto — o padrão `.env` atual já cobre, mas confirmar.

### Success Criteria

#### Automated Verification
- [x] `docker compose -f docker-compose.prod.yml config` — compose válido
- [x] `docker compose -f docker-compose.prod.yml build` — as três imagens buildam
- [x] `test -f apps/api/Dockerfile && test -f apps/web/Dockerfile && test -f docker-compose.prod.yml && test -f .env.example`

#### Manual Verification
- [ ] `cp .env.example .env`, preencher, `docker compose -f docker-compose.prod.yml up -d --build` sobe os três serviços
- [ ] Migrations aplicadas automaticamente (tabelas criadas no Postgres)
- [ ] Web em `http://localhost:8080` carrega e faz login contra a API em `:3000`
- [ ] Nenhum secret real presente em arquivos versionados

**⏸ PAUSE**: Parar para confirmação humana. Após esta fase, o repositório está pronto para ser tornado público.

---

## Testing Strategy

### Unit Tests
- Não há lógica de aplicação nova nesta spec (mudanças são docs, config e empacotamento). Sem testes unitários novos.

### Integration Tests
- Smoke test manual do stack de produção: `up --build` → login → criar um cliente → confirmar persistência no Postgres do container.

### Migration & Rollback
- Nada é destrutivo. Rollback = reverter os commits. As imagens Docker são novas e não afetam o fluxo de dev existente (`docker compose up -d` continua subindo só o Postgres).

## Environment Considerations
- **CI/CD**: sem mudanças de pipeline nesta spec.
- **Migrations**: o `Dockerfile` da API roda `prisma migrate deploy` no boot — confirmar que o role/URL de produção tem permissão de migrar (o `DATABASE_URL` superuser, não o `APP_DATABASE_URL`).
- **Config/Secrets**: novo `.env` na raiz para o compose de produção. **Rotacionar** quaisquer secrets de dev (`crm_password`, `dev-…-troque-em-producao`) que estejam em uso em algum ambiente real — independente de abrir o repo.
- **Multi-environment**: dev continua com `docker-compose.yml` (só Postgres); produção usa `docker-compose.prod.yml` (stack completo).

## Dependencies & Risks
- **Caminho do entrypoint compilado** da API precisa ser confirmado antes de fixar o `CMD` do Dockerfile.
- **Leitura de env no container**: confirmar que `@nestjs/config` lê de `process.env` sem exigir arquivo físico; ajustar `envFilePath` se preciso.
- **Trademark ≠ licença**: reforçar no README que o nome não é coberto pela Apache 2.0 — é a única proteção contra clones idênticos.

## References
- Auditoria de segredos: executada em 2026-07-24 — repo limpo, sem reescrita de histórico.
- Spec relacionada: `specs/plans/2026-07-24-billing-stripe.md`
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0.txt
- Regras de arquitetura: `CLAUDE.md`, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`
