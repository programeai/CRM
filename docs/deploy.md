# Deploy em produção

> **Quer só subir sua própria instância?** Vá para
> [autohospedagem.md](./autohospedagem.md). Este documento descreve o deploy do
> **mantenedor**, que depende de imagens publicadas num Docker Hub específico e
> de um Traefik já configurado no host — não funciona copiado e colado.

O CRM sobe como um Compose isolado (nome de projeto, rede interna e volume
próprios) atrás de um **reverse proxy** que já exista no host — os exemplos aqui
usam Traefik. Nada é compartilhado com outros projetos do host além da rede
pública do proxy.

## Topologia

Host único, front e API na mesma origem:

```
                       ┌─ Traefik (websecure, TLS via ${ACME_RESOLVER})
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

- Rede externa do proxy existe: `docker network ls | grep traefik-proxy`.
- Um resolver ACME configurado no Traefik. O nome dele vai no secret
  `ACME_RESOLVER` — o compose não tem default, e o workflow de deploy falha
  antes de conectar na VPS se o secret estiver ausente.
- Usuário de deploy com acesso ao socket do Docker.
- Diretório de deploy (o do secret `DEPLOY_DIR`) gravável por esse usuário.

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
| `CRM_DOMAIN` | host público, ex.: `crm.programeai.com.br` |
| `ACME_RESOLVER` | nome do resolver ACME do seu Traefik |
| `DEPLOY_DIR` | diretório de deploy na VPS, ex.: `~/apps/crm` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | banco |
| `APP_DB_PASSWORD` | senha da role `crm_app` (RLS) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥32 caracteres cada |

Gere os segredos com `openssl rand -hex 32`. **`APP_DB_PASSWORD` não pode conter
apóstrofo nem barra invertida** — ela entra literal num `ALTER ROLE` e o
entrypoint aborta se encontrar esses caracteres.

Secret com **`$`** é seguro, mas só porque o workflow de deploy escapa o `$`
como `$$` ao gerar o `.env`. Sem esse escape o Compose interpreta o que vem
depois do `$` como nome de variável e substitui por vazio: em 27/07/2026 um
`SMTP_PASSWORD` de 32 caracteres chegou ao container com 13 e o envio de e-mail
morreu sem nenhum erro no boot. Se você editar o `.env` da VPS na mão, escape o
`$` você também — e confira com
`docker exec crm-api printenv SMTP_PASSWORD | wc -c`.

Opcionais (podem ficar em branco): OAuth (`GOOGLE_*`, `GITHUB_*`), captcha
(`TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`), SMTP (`SMTP_*`,
`MAIL_FROM`), Stripe (`BILLING_ENABLED`, `STRIPE_*`) e o autocadastro
(`REGISTRATION_ENABLED` — ausente vale `true`; ver "Primeiro acesso").

## Pipeline

São **dois workflows separados**: build automático, deploy no botão. Push na
`main` publica imagem mas não muda nada em produção.

### 1. Build — `.github/workflows/build.yml`

Automático a cada push na `main` (ou manual). Job único, para não pagar setup
duas vezes — minutos de Actions são cobrados **por job, arredondados para cima**.

Ordem dos steps: detectar apps afetados → testes da API (portão) → build e push
de `crm-api` / `crm-web` no Docker Hub, com as tags `latest` e `<sha do commit>` e
cache do Actions por imagem.

O portão de qualidade é só `pnpm --filter api test`. Compilar API e front aqui
seria trabalho duplicado: os Dockerfiles já rodam `nest build` e
`tsc -b && vite build`, e build que falha não publica imagem nenhuma.

**O build é seletivo — nem todo push reconstrói tudo:**

| Commit toca | Resultado |
| --- | --- |
| só `*.md`, `docs/`, `specs/`, `.claude/`, `.agents/`, `.github/`, `.env.example`, compose | **nenhum runner é alocado** (`paths-ignore`) — zero minutos |
| só `apps/web/**` | reconstrói apenas `crm-web` |
| só `apps/api/**` | reconstrói apenas `crm-api` (só aqui os testes rodam) |
| raiz compartilhada (`pnpm-lock.yaml`, `package.json`, `.dockerignore`) ou caminho desconhecido | reconstrói as duas |
| force-push / branch nova | reconstrói as duas (sem base para comparar) |

No dispatch manual não existe commit base para diff, então quem roda escolhe no
input `reconstruir`: `ambas` (default), `api` ou `web`. Serve para o caso do
"Variáveis de build vs. runtime" abaixo — trocar uma `VITE_*` exige rebuild só do
front, e `reconstruir: web` faz isso pagando metade dos minutos.

> **Primeira execução:** com o registry vazio, rode uma vez em `ambas` (dispatch
> manual) para semear `crm-api:latest` e `crm-web:latest`. O build seletivo
> depende do `latest` existir para tagear a imagem que ele não reconstrói; até lá
> esse step só emite `::warning::` e o sha fica sem uma das imagens.

A imagem **não** reconstruída ainda recebe a tag do sha novo, apontando para o
mesmo manifest do `latest` (`docker buildx imagetools create` — cópia de ponteiro
no registry, segundos, sem rebuild). Isso preserva a garantia que o rollback
usa: **todo sha que passou pelo build tem as duas imagens**.

Consequência a ter em mente: sha de commit que o `paths-ignore` barrou (um commit
só de docs, por exemplo) **não** tem imagem. Rollback nesse sha falha no step de
conferência do deploy, com erro explícito — use o sha do último commit de código.

O resumo da execução mostra o SHA publicado e o que foi reconstruído ou
reaproveitado — é o valor a colar no deploy.

### 2. Deploy — `.github/workflows/deploy.yml`

**Só manual:** Actions → *Deploy na VPS* → *Run workflow*. Recebe um input:

| Input | Valor |
| --- | --- |
| `tag` | `latest` (default, última imagem da `main`) ou o SHA completo de um commit |

O workflow confere se a tag existe no Docker Hub (falha rápido em SHA digitado
errado ou build ainda em andamento), copia o compose, escreve o `.env` no
diretório de `DEPLOY_DIR` a partir dos secrets e roda `pull` + `up -d` +
`docker image prune -af`.

Quando a `tag` é um SHA, o checkout usa **aquele commit** — o compose vai junto
com a imagem, senão um rollback subiria imagem antiga com compose novo.

A VPS não compila nada — só puxa imagem pronta.

### Variáveis de build vs. runtime

As `VITE_*` são embutidas no bundle **em build-time**. Trocar
`VITE_TURNSTILE_SITE_KEY` exige **rodar o workflow de build de novo** (e depois o
deploy); reiniciar o container não muda o bundle. Todo o resto (JWT, SMTP, OAuth,
Stripe, banco) é runtime e basta um novo deploy.

## O que acontece a cada start da API

O entrypoint (`apps/api/docker/entrypoint.sh`) é idempotente:

1. `prisma migrate deploy` (como `crm_user`, dono do schema), com até 10
   tentativas para tolerar o Postgres ainda subindo;
2. `ALTER ROLE crm_app` com a `APP_DB_PASSWORD` — a migration
   `20260724040000_create_app_role` cria a role com senha de desenvolvimento, e
   é aqui que ela passa a valer a senha real de produção. **Sem
   `APP_DB_PASSWORD` o boot aborta**: seguir em frente deixaria o banco com a
   senha de desenvolvimento, que é pública neste repositório;
3. `node apps/api/dist/src/main.js`.

## Primeiro acesso

Não há seed de admin em produção (o seed do repositório é dataset de demo). A
primeira conta é criada em `https://<seu-dominio>/registrar`.

> **Depois de criar sua conta**, feche o autocadastro: cadastre o secret
> `REGISTRATION_ENABLED=false` e rode um novo deploy. Isso fecha `/registrar` e
> a criação de conta nova por OAuth; o acesso de novas pessoas passa a ser por
> convite de colaborador. Deixar aberto significa que qualquer um com o endereço
> da instância cria conta — o captcha (`TURNSTILE_SECRET_KEY`) reduz o abuso
> automatizado, mas não é um controle de acesso.

## Operação

Log do dia a dia é no **Grafana** da stack de observabilidade do host, não por
SSH: `{stack="crm"}` traz o projeto inteiro e `{stack="crm", level="error"}` só os
erros. Ver [observabilidade.md](observabilidade.md) — inclui como usar o
`x-request-id` para puxar uma requisição inteira.

```bash
cd <dir-de-deploy>          # o mesmo valor do secret DEPLOY_DIR

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

**Dump pontual** (fora da rotina, para levar uma cópia antes de uma operação
arriscada):

```bash
cd <dir-de-deploy>          # o mesmo valor do secret DEPLOY_DIR
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > "crm-$(date +%F).dump"
```

**Rotina.** `scripts/backup-postgres.sh` roda pelo cron do **host** (fora dos
containers), gera um dump, mantém o ledger de encerramentos e apaga o que
passou da retenção:

```cron
0 2 * * * DEPLOY_DIR=<dir-de-deploy> BACKUP_DIR=/var/backups/crm /caminho/do/repo/scripts/backup-postgres.sh >> /var/log/crm-backup.log 2>&1
```

`RETENCAO_DIAS` (default 30) é **o número que a Política de Privacidade
publica** — mudá-lo exige mudar a página em `apps/web/src/features/legal/PrivacidadePage.tsx`.

Restauração: `pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"`
via `exec -T`. O volume `crm_pgdata` sobrevive a `down`/`up`; **não** rode
`down -v` em produção.

#### Restauração e contas encerradas

Restaurar um backup pode ressuscitar dados de uma conta já encerrada. Duas
coisas cobrem isso, e as duas precisam ser conferidas:

1. **Automático.** Um `User` restaurado com `deletionScheduledFor` no passado é
   expurgado pelo `AccountPurgeJob` na varredura seguinte (até 24h). Vale para
   todo backup tirado **depois** do pedido de encerramento — o caso comum.
2. **Manual, obrigatório.** Para backup tirado **antes** do pedido, o
   agendamento não existe no dump. Confira `encerramentos.csv` no diretório de
   backup: cada `ownerId` listado com data posterior à do dump restaurado
   precisa ser reagendado à mão —

   ```sql
   UPDATE "User" SET "deletionRequestedAt" = now(), "deletionScheduledFor" = now() - interval '1 day'
    WHERE id = '<ownerId>';
   ```

   — e o job cuida do resto na próxima varredura.

Sem este passo, a promessa de exclusão quebra no primeiro disaster recovery.

**Interruptor de emergência.** Se o cron de expurgo (`AccountPurgeJob`, 5h)
precisar ser parado sem deploy, empurre todos os agendamentos vigentes para a
frente sem perder o pedido:

```sql
UPDATE "User" SET "deletionScheduledFor" = now() + interval '30 days'
 WHERE "deletionScheduledFor" IS NOT NULL;
```

### Rollback

Toda imagem é tagueada com o SHA do commit, então voltar uma versão é rodar o
workflow **Deploy na VPS** com `tag` = SHA do commit bom. Nada de `docker tag` na
mão: o `IMAGE_TAG` no `.env` da VPS passa a apontar para aquela imagem, e o
compose usado é o daquele commit.

Migrations **não** são revertidas automaticamente — se o deploy problemático
aplicou migration, avalie o `down` manual antes de voltar a imagem.

Se precisar mesmo agir direto na VPS (GitHub fora do ar, por exemplo):

```bash
cd <dir-de-deploy>          # o mesmo valor do secret DEPLOY_DIR
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<sha-anterior>/' .env
docker compose -f docker-compose.prod.yml pull api web
docker compose -f docker-compose.prod.yml up -d
```

## Desenvolvimento local

Nada disso é usado em dev. Continue com:

```bash
pnpm db:up   # só o Postgres (docker-compose.yml)
pnpm dev     # api + web em paralelo
```
