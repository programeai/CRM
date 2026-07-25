# Deploy em produção

O CRM roda na mesma VPS do Dorado da Sorte, atrás do **Traefik** que já está lá.
Cada projeto é um Compose isolado (nome de projeto, rede interna e volume
próprios) — nada é compartilhado além da rede pública do Traefik.

## Topologia

Host único, front e API na mesma origem:

```
                       ┌─ Traefik (websecure, TLS via factis_resolver)
                       │
crm.programeai.com.br/           → crm-web   (nginx:80, bundle do Vite)
crm.programeai.com.br/api/v1/*   → crm-api   (NestJS:3000)
                                       │
                                       └─ rede "interna" → crm-postgres:5432
```

Consequências dessa escolha:

- **Sem CORS e sem cookie cross-site.** O front chama `/api/v1` relativo
  (`VITE_API_URL=/api/v1`), então `FRONTEND_URL`, `API_URL` e `COOKIE_DOMAIN`
  são todos o mesmo host.
- O roteamento depende de **prioridade explícita** nos routers do Traefik
  (`crm-api` = 10, `crm-web` = 1). Sem isso o Traefik usaria o tamanho da regra
  como prioridade e o front poderia capturar `/api`.
- O Postgres **não** é exposto ao host nem ao Traefik. Acesso só de dentro da
  rede `interna` (ou via `docker compose exec`).

## Pré-requisitos na VPS

Já atendidos pelo deploy do Dorado, mas confirme:

- Rede externa do Traefik existe: `docker network ls | grep traefik-proxy`.
- O resolver ACME `factis_resolver` está configurado em `/opt/traefik/traefik.yml`
  (é o único; não invente outro nome).
- Usuário de deploy com acesso ao socket do Docker.

## DNS

Antes do primeiro deploy, aponte um registro **A** de `crm.programeai.com.br`
para o IP da VPS. O Traefik só consegue emitir o certificado depois que o DNS
resolve — senão o container sobe e o HTTPS falha.

## Secrets do GitHub

`Settings → Secrets and variables → Actions`. A lista completa e comentada está
em [`.env.example`](../.env.example) — ele é o contrato: cada variável de lá é um
secret aqui.

Mínimo para subir:

| Secret | Observação |
| --- | --- |
| `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | publicação das imagens |
| `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_KEY` | acesso à VPS |
| `CRM_DOMAIN` | `crm.programeai.com.br` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | banco |
| `APP_DB_PASSWORD` | senha da role `crm_app` (RLS) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥32 caracteres cada |

Gere os segredos com `openssl rand -hex 32`. **`APP_DB_PASSWORD` não pode conter
apóstrofo nem barra invertida** — ela entra literal num `ALTER ROLE` e o
entrypoint aborta se encontrar esses caracteres.

Opcionais (podem ficar em branco): OAuth (`GOOGLE_*`, `GITHUB_*`), captcha
(`TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`), SMTP (`SMTP_*`,
`MAIL_FROM`) e Stripe (`BILLING_ENABLED`, `STRIPE_*`).

## Pipeline

`.github/workflows/deploy.yml`, disparado por push na `main` ou manualmente:

1. **verificar** — `pnpm install --frozen-lockfile`, `prisma generate`, build da
   API, build do front e testes da API. Nada é publicado se isso falhar.
2. **build-and-deploy** — build e push de `crm-api` e `crm-web` para o Docker Hub
   (tags `latest` e `<sha>`, cache do GitHub Actions por imagem), escrita do
   `.env` em `~/programeai/prod/crm` a partir dos secrets, `docker compose pull`
   + `up -d` e `docker image prune -af`.

A VPS não compila nada — só puxa imagem pronta.

### Variáveis de build vs. runtime

As `VITE_*` são embutidas no bundle **em build-time**. Trocar
`VITE_TURNSTILE_SITE_KEY` exige **rodar o workflow de novo**; reiniciar o
container não muda o bundle. Todo o resto (JWT, SMTP, OAuth, Stripe, banco) é
runtime e basta um novo `up -d`.

## O que acontece a cada start da API

O entrypoint (`apps/api/docker/entrypoint.sh`) é idempotente:

1. `prisma migrate deploy` (como `crm_user`, dono do schema), com até 10
   tentativas para tolerar o Postgres ainda subindo;
2. `ALTER ROLE crm_app` com a `APP_DB_PASSWORD` — a migration
   `20260724040000_create_app_role` cria a role com senha de desenvolvimento, e
   é aqui que ela passa a valer a senha real de produção;
3. `node apps/api/dist/src/main.js`.

## Primeiro acesso

Não há seed de admin em produção (o seed do repositório é dataset de demo). A
primeira conta é criada em `https://crm.programeai.com.br/registro`.

> **Atenção:** `POST /auth/register` é público. Numa instância interna de agência,
> considere restringir o autocadastro depois de criar sua conta — hoje o único
> freio é o captcha, se `TURNSTILE_SECRET_KEY` estiver configurada.

## Operação

```bash
cd ~/programeai/prod/crm

docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web

# Health (de dentro da VPS, sem passar pelo Traefik)
docker compose -f docker-compose.prod.yml exec api \
  node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>r.json()).then(console.log)"

# Psql
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

### Backup do banco

```bash
cd ~/programeai/prod/crm
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > "crm-$(date +%F).dump"
```

Restauração: `pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"`
via `exec -T`. O volume `crm_pgdata` sobrevive a `down`/`up`; **não** rode
`down -v` em produção.

### Rollback

As imagens são tagueadas com o SHA do commit. Para voltar uma versão, edite o
`.env` da VPS ou rode com a tag anterior:

```bash
docker pull SEU_USUARIO/crm-api:<sha-anterior>
docker tag SEU_USUARIO/crm-api:<sha-anterior> SEU_USUARIO/crm-api:latest
docker compose -f docker-compose.prod.yml up -d api
```

Migrations não são revertidas automaticamente — se o deploy problemático aplicou
migration, avalie o `down` manual antes de voltar a imagem.

## Desenvolvimento local

Nada disso é usado em dev. Continue com:

```bash
pnpm db:up   # só o Postgres (docker-compose.yml)
pnpm dev     # api + web em paralelo
```
