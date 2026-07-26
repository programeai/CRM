---
date: 2026-07-25T23:55:55-03:00
author: claude
source_prd: specs/research/2026-07-25-ajustes-open-source-producao.md
git_commit: 992b5075f606fcc108e2a6d252eda3de26537218
branch: main
status: draft
tags: [spec, open-source, seguranca, throttler, licenca, docs, ci]
---

# Spec: Ajustes para abrir o repositório com produção no ar

## Overview

Três frentes para tornar `programeai/CRM` público sem expor a topologia da VPS nem
deixar a instância viva de `crm.programeai.com.br` mais frágil do que está hoje.

A frente de **publicação** corrige metadados de licença e genericiza os runbooks: hoje
`docs/deploy.md` e `docs/observabilidade.md` documentam o nome de um projeto de terceiro,
o diretório de deploy, o resolver ACME e o host do Grafana. A frente de **endurecimento**
resolve o problema mais concreto que o repo público cria: sem `trust proxy`, `req.ip` é
sempre o IP do container do Traefik, então o `@Throttle(5/min)` de `/auth/login` é um
balde **único global** — cinco tentativas por minuto derrubam o login de todos os
usuários, e qualquer um que leia o código público sabe disso. A mesma linha conserta o
`remoteip` que vai ao Turnstile. Junto vêm `helmet`, o gate de autocadastro e o hard-fail
da senha da role `crm_app`. A frente de **comunidade** adiciona os arquivos que o GitHub
espera de um repositório público.

A ordem é deliberada: a Fase 1 não gasta minuto de Actions (`paths-ignore` cobre tudo) e
não exige deploy; as Fases 2 e 3 mexem em código e lockfile, disparam build e exigem
deploy; a Fase 4 volta a ser gratuita. Cada fase é independente — nenhuma depende do
código da anterior.

## Current State

A spec `specs/plans/2026-07-24-preparar-open-source.md` já está implementada: `LICENSE`
(Apache 2.0), `NOTICE`, `CONTRIBUTING.md`, README com autohospedagem/licença/trademark,
Dockerfiles e `docker-compose.prod.yml`. A auditoria de segredos deu resultado limpo e foi
reconfirmada — **não há reescrita de histórico nem rotação de secrets neste escopo**.

O repositório é privado (`programeai/CRM`, `visibility: PRIVATE`). Ver o PRD para o mapa
completo. Três pontos do PRD estão desatualizados e foram verificados contra o código:

1. **`.env.example:54` já está corrigido e commitado.** `git show HEAD:.env.example`
   traz `roteado pelo Traefik até a API`. O PRD registrou isso como mudança pendente no
   working tree; não há o que fazer.
2. **O slug canônico é `programeai/CRM`.** O remote local aponta para
   `Edsonalencar/CRM` (redirect de transferência). URLs novas usam `programeai/CRM`.
3. **Existem três caminhos de criação de conta, não dois.** Além de `POST /auth/register`
   e do ramo `users.createWithOAuth` em `AuthService.oauthLogin`, o trabalho de
   colaboradores/papéis no working tree cria usuários por **convite do owner**
   (`CollaboratorsService.create` → `collaborators.create`, com `ownerId` preenchido e
   `passwordHash: null`). Esse caminho **não** passa pelo `AuthService` e por isso não é
   afetado pelo gate — mas isso precisa estar coberto por teste, senão uma refatoração
   futura fecha a porta dos colaboradores sem ninguém perceber.

O working tree tem uma feature grande em andamento (colaboradores e papéis, com migration
ainda não aplicada). Esta spec é executável em cima dela: nenhum arquivo desta spec
conflita com os arquivos daquela, exceto `auth.service.ts` e `auth.controller.ts`, que
recebem adições isoladas.

## Desired End State

- Os três `package.json` declaram `"license": "Apache-2.0"`; `private: true` permanece.
- `docs/deploy.md` e `docs/observabilidade.md` são receitas reproduzíveis: nenhuma menção
  a projeto de terceiro, nenhum caminho de host, nenhum nome de resolver ACME, nenhum host
  de Grafana. O domínio `crm.programeai.com.br` permanece como exemplo concreto.
- `ACME_RESOLVER` e `DEPLOY_DIR` são secrets. O `deploy.yml` **falha no runner**, antes de
  qualquer SSH, se algum estiver ausente — as duas strings saem do repositório e a
  produção não corre risco: um dispatch que falha não toca a VPS.
- `APRESENTACAO-PRODUTO.md` sai do versionamento (fica no `.gitignore`).
  `ROADMAP.md`, `SPEC.md` e `specs/` continuam versionados.
- `TRUST_PROXY_HOPS` (default `1`) faz o Express derivar `req.ip` do `x-forwarded-for`.
  Como consequência direta e sem código extra, o `ThrottlerGuard` (cujo `getTracker`
  default é `return req.ip`) passa a contar **por cliente**, e o Turnstile recebe o
  `remoteip` correto. `ipDoCliente()` deixa de existir: `req.ip` é a única fonte de verdade.
- `helmet()` responde nas rotas `/api`, que o Traefik roteia direto ao Nest sem passar
  pelo nginx do front.
- `entrypoint.sh` **aborta** quando `APP_DB_PASSWORD` está vazia, em vez de seguir com a
  senha de desenvolvimento que a migration grava e que passa a ser pública.
- `REGISTRATION_ENABLED` (default `true`) fecha `POST /auth/register` **e** o ramo de
  criação do OAuth. O convite de colaborador continua funcionando com a flag em `false`.
  `GET /auth/registration` informa o estado ao front, que esconde o que não funciona.
- `.github/` tem `SECURITY.md`, `CODE_OF_CONDUCT.md`, `ISSUE_TEMPLATE/`,
  `PULL_REQUEST_TEMPLATE.md` e `dependabot.yml`.

## What We're NOT Doing

- **Reescrita de histórico git.** Duas auditorias independentes deram limpo. Os únicos
  valores versionados são de desenvolvimento (`crm_password`, `crm_app_password`,
  `changeme123`, `dev-access-secret-…`), e nenhum `.env` foi rastreado.
- **Rotação dos secrets de produção.** Eles vivem só como GitHub Secrets, consumidos pelo
  `deploy.yml`; nada vaza ao tornar o repo público.
- **Editar a migration `20260724040000_create_app_role`** para trocar a senha de dev.
  Migrations aplicadas são checksumadas pelo Prisma: alterar o arquivo faz
  `migrate deploy` falhar em todo banco que já a aplicou — inclusive o de produção. O
  hard-fail do entrypoint torna essa senha inalcançável em produção, que é o objetivo real.
- **Renomear os pacotes internos** (`name: "api"`, `name: "web"`) nem preencher
  `description`/`author` vazios do `apps/api/package.json`. A spec anterior declarou isso
  fora de escopo; só o campo `license` era a lacuna.
- **`getTracker` customizado no `ThrottlerModule`.** Confirmado em
  `node_modules/@nestjs/throttler/dist/throttler.guard.js:141` que o default é
  `return req.ip`; com `trust proxy` configurado ele já está correto. Um override seria
  uma segunda fonte de verdade para o mesmo dado.
- **Tirar `specs/`, `ROADMAP.md` ou `SPEC.md` do versionamento.** Histórico de decisão é
  ativo em projeto open source, e sem reescrita de histórico remover arquivos não os
  removeria do passado do repo.
- **Allowlist de domínio de e-mail no cadastro.** A flag booleana cobre o caso real; uma
  lista adiciona superfície de código e de teste sem necessidade demonstrada.
- **Private Vulnerability Reporting.** É opção de repositório (Settings → Code security),
  não arquivo versionado. Entra como passo manual na Fase 4.

---

## Phase 1: Publicação — metadados de licença e genericização dos docs

### Goal

Remover os bloqueadores de publicação e tirar a topologia da VPS do repositório, sem
tocar em código de aplicação nem exigir deploy.

### Changes

#### Metadados de licença

**Modify**: `package.json`

Adicionar `license` depois de `private`. O `private: true` permanece — é o que evita
publish acidental no npm.

```json
{
  "name": "crm",
  "private": true,
  "license": "Apache-2.0",
  "packageManager": "pnpm@9.15.0",
```

**Modify**: `apps/api/package.json:7`

```json
  "private": true,
  "license": "Apache-2.0",
```

(substitui `"license": "UNLICENSED"`, que contradizia o `LICENSE` da raiz)

**Modify**: `apps/web/package.json`

```json
{
  "name": "web",
  "private": true,
  "license": "Apache-2.0",
  "version": "0.0.0",
```

#### Documento interno fora do versionamento

**Modify**: `.gitignore`

```gitignore
apps/api/prisma/*.db

# Material interno de marketing — não faz parte do produto open source.
APRESENTACAO-PRODUTO.md
```

Depois: `git rm --cached APRESENTACAO-PRODUTO.md` (o arquivo continua no disco).

#### Divergência de porta na documentação

**Modify**: `CLAUDE.md`, seção "Ferramentas do monorepo"

O `docker-compose.yml:11` publica `5435:5432`; o README já está correto.

```markdown
- Banco local via `docker compose up -d` (Postgres 16 em `localhost:5435`).
```

#### Resolver ACME e diretório de deploy como secrets

**Modify**: `docker-compose.prod.yml:1-3` (comentário de cabeçalho)

```yaml
# Deploy de produção. Roteamento e TLS ficam a cargo de um reverse proxy já
# existente no host (Traefik neste exemplo), que precisa de uma rede externa
# chamada "traefik-proxy" e de um resolver ACME configurado — o nome do resolver
# vem de ACME_RESOLVER (ver .env.example).
```

**Modify**: `docker-compose.prod.yml:51` e `docker-compose.prod.yml:125`

Nas duas ocorrências, o valor literal sai:

```yaml
      - traefik.http.routers.crm-web.tls.certresolver=${ACME_RESOLVER}
```

```yaml
      - traefik.http.routers.crm-api.tls.certresolver=${ACME_RESOLVER}
```

**Sem default de propósito.** Um default errado subiria o container com resolver
inexistente e o HTTPS falharia; o `deploy.yml` (abaixo) garante que a variável sempre
chegue ao `.env`, falhando no runner se o secret não existir.

**Modify**: `docker-compose.prod.yml:151-156` (comentário das redes)

```yaml
networks:
  # Rede compartilhada com o reverse proxy (criada fora deste compose). O nome
  # externo esperado é "traefik-proxy"; o alias local "traefik" aponta pra ela.
  traefik:
    external: true
    name: traefik-proxy
```

**Modify**: `.env.example` — novo bloco depois do bloco `--- Domínio ---`

```bash
# --- Reverse proxy / TLS ---
# Nome do resolver ACME configurado no seu Traefik (o que emite o certificado
# para CRM_DOMAIN). É o valor que vai em `certresolver=` nos labels do compose.
# Não tem default: o deploy falha se este secret não estiver cadastrado.
ACME_RESOLVER=letsencrypt

# --- Diretório de deploy na VPS (apenas GitHub Secret) ---
# Onde o workflow de deploy escreve o compose e o .env, e de onde roda o
# `docker compose`. Ex.: ~/apps/crm
DEPLOY_DIR=~/apps/crm
```

**Modify**: `.github/workflows/deploy.yml`

Novo step **antes** do "Login no Docker Hub" — falha no runner, sem tocar a VPS:

```yaml
      # Estes dois não têm default em lugar nenhum: ACME_RESOLVER errado quebraria
      # o TLS e DEPLOY_DIR vazio faria o compose rodar no home do usuário. Falhar
      # aqui é gratuito — um dispatch que para no runner não altera a produção.
      - name: Conferir configuração da VPS
        env:
          ACME_RESOLVER: ${{ secrets.ACME_RESOLVER }}
          DEPLOY_DIR: ${{ secrets.DEPLOY_DIR }}
        run: |
          set -e
          faltando=""
          [ -n "$ACME_RESOLVER" ] || faltando="$faltando ACME_RESOLVER"
          [ -n "$DEPLOY_DIR" ] || faltando="$faltando DEPLOY_DIR"
          if [ -n "$faltando" ]; then
            echo "::error::Secrets ausentes:$faltando. Cadastre em Settings → Secrets and variables → Actions (ver .env.example)."
            exit 1
          fi
```

Nos três steps que hoje usam `~/programeai/prod/crm` literal, trocar por
`${{ secrets.DEPLOY_DIR }}`:

```yaml
      - name: Criar diretório de deploy na VPS
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          port: ${{ secrets.SSH_PORT }}
          script: mkdir -p ${{ secrets.DEPLOY_DIR }}

      - name: Copiar docker-compose para a VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          port: ${{ secrets.SSH_PORT }}
          source: "docker-compose.prod.yml"
          target: ${{ secrets.DEPLOY_DIR }}
```

No step "Deploy na VPS": adicionar `ACME_RESOLVER` ao `envs`, trocar o `cd` e escrever a
variável no `.env` gerado.

```yaml
          envs: IMAGE_TAG,DOCKERHUB_USERNAME,CRM_DOMAIN,ACME_RESOLVER,POSTGRES_USER,POSTGRES_PASSWORD,POSTGRES_DB,APP_DB_PASSWORD,JWT_ACCESS_SECRET,JWT_REFRESH_SECRET,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,TURNSTILE_SECRET_KEY,SMTP_HOST,SMTP_PORT,SMTP_SECURE,SMTP_USER,SMTP_PASSWORD,MAIL_FROM,BILLING_ENABLED,STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET,STRIPE_PRICE_ID
          script: |
            set -e
            cd ${{ secrets.DEPLOY_DIR }}

            # Gera o .env consumido pelo docker-compose.prod.yml
            umask 077
            cat > .env <<EOF
            IMAGE_TAG=${IMAGE_TAG}
            DOCKERHUB_USERNAME=${DOCKERHUB_USERNAME}
            CRM_DOMAIN=${CRM_DOMAIN}
            ACME_RESOLVER=${ACME_RESOLVER}
            POSTGRES_USER=${POSTGRES_USER}
```

E o `env:` do job, onde os secrets são mapeados — adicionar na mesma lista dos demais:

```yaml
          ACME_RESOLVER: ${{ secrets.ACME_RESOLVER }}
```

> Nota de implementação: conferir onde o `deploy.yml` mapeia os secrets para `env` do
> step (o `envs:` do `ssh-action` só passa adiante variáveis que já existem no ambiente
> do step). `ACME_RESOLVER` tem de aparecer nos **dois** lugares.

#### `docs/deploy.md` — genericização

**Modify**: `docs/deploy.md:1-5`

```markdown
# Deploy em produção

O CRM sobe como um Compose isolado (nome de projeto, rede interna e volume
próprios) atrás de um **reverse proxy** que já exista no host — os exemplos aqui
usam Traefik. Nada é compartilhado com outros projetos do host além da rede
pública do proxy.
```

**Modify**: `docs/deploy.md:11-18` (diagrama)

```
                       ┌─ Traefik (websecure, TLS via ${ACME_RESOLVER})
                       │
crm.programeai.com.br/           → crm-web   (nginx:80, bundle do Vite)
crm.programeai.com.br/api/v1/*   → crm-api   (NestJS:3000)
                                       │
                                       └─ rede "interna" → crm-postgres:5432
```

**Modify**: `docs/deploy.md:31-38` (pré-requisitos)

```markdown
## Pré-requisitos na VPS

- Rede externa do proxy existe: `docker network ls | grep traefik-proxy`.
- Um resolver ACME configurado no Traefik. O nome dele vai no secret
  `ACME_RESOLVER` — o compose não tem default, e o workflow de deploy falha
  antes de conectar na VPS se o secret estiver ausente.
- Usuário de deploy com acesso ao socket do Docker.
- Diretório de deploy (o do secret `DEPLOY_DIR`) gravável por esse usuário.
```

**Modify**: `docs/deploy.md:52-62` (tabela de secrets mínimos) — duas linhas novas

```markdown
| `CRM_DOMAIN` | host público, ex.: `crm.programeai.com.br` |
| `ACME_RESOLVER` | nome do resolver ACME do seu Traefik |
| `DEPLOY_DIR` | diretório de deploy na VPS, ex.: `~/apps/crm` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | banco |
```

**Modify**: `docs/deploy.md:129-135` (descrição do deploy)

```markdown
O workflow confere se a tag existe no Docker Hub (falha rápido em SHA digitado
errado ou build ainda em andamento), copia o compose, escreve o `.env` no
diretório de `DEPLOY_DIR` a partir dos secrets e roda `pull` + `up -d` +
`docker image prune -af`.
```

**Modify**: `docs/deploy.md:157-164` (primeiro acesso)

O link estava quebrado: a rota registrada em `apps/web/src/routes/router.tsx:46` é
`/registrar`, não `/registro`. O aviso sobre autocadastro é reescrito na Fase 3.

```markdown
## Primeiro acesso

Não há seed de admin em produção (o seed do repositório é dataset de demo). A
primeira conta é criada em `https://<seu-dominio>/registrar`.
```

**Modify**: `docs/deploy.md:166-200` (operação) — trocar o host do Grafana e os `cd`

```markdown
## Operação

Log do dia a dia é no **Grafana** da stack de observabilidade do host, não por
SSH: `{stack="crm"}` traz o projeto inteiro e `{stack="crm", level="error"}` só os
erros. Ver [observabilidade.md](observabilidade.md) — inclui como usar o
`x-request-id` para puxar uma requisição inteira.

```bash
cd <dir-de-deploy>          # o mesmo valor do secret DEPLOY_DIR
```

As demais ocorrências de `cd ~/programeai/prod/crm` (backup, rollback manual) recebem o
mesmo tratamento.

#### `docs/observabilidade.md` — genericização

**Modify**: `docs/observabilidade.md:3-5`

```markdown
Os logs do CRM são lidos pela **stack de observabilidade do host**: um agente
(Alloy) coleta o stdout de todos os containers, o Loki indexa e o Grafana
consulta.
```

**Modify**: `docs/observabilidade.md:130-138` (verificação pós-deploy)

```bash
# Uma requisição real e o id que ela devolveu
curl -sD - -o /dev/null https://<seu-dominio>/api/v1/health | grep -i x-request-id
```

A nota final sobre `trust proxy` (L158-160) é corrigida na Fase 2, junto com a mudança
que a torna falsa.

### Success Criteria

#### Automated Verification
- [ ] `node -e "['package.json','apps/api/package.json','apps/web/package.json'].forEach(p=>{const l=require('./'+p).license; if(l!=='Apache-2.0') throw new Error(p+': '+l)})"` — os três manifestos declaram Apache-2.0
- [ ] `docker compose -f docker-compose.prod.yml config -q` com um `.env` que tenha `ACME_RESOLVER` — o compose é válido e a variável resolve
- [ ] `! grep -rniE "dorado|factis|programeai/prod" docs/ docker-compose.prod.yml .github/ .env.example` — nenhuma menção a projeto de terceiro, resolver ou caminho de deploy sobrou
- [ ] `! grep -rn "grafana.programeai.com.br" docs/` — host do Grafana removido
- [ ] `! grep -rn "5432" CLAUDE.md` — porta de dev corrigida
- [ ] `git ls-files APRESENTACAO-PRODUTO.md` não retorna nada, e `test -f APRESENTACAO-PRODUTO.md` passa (saiu do índice, ficou no disco)
- [ ] `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"` — o workflow continua YAML válido
- [ ] `grep -c 'secrets.DEPLOY_DIR' .github/workflows/deploy.yml` retorna `4` (pré-flight + 3 steps)
- [ ] `pnpm --filter api test` — nada de código mudou, a suíte segue verde

#### Manual Verification
- [ ] Ler `docs/deploy.md` de ponta a ponta como se fosse um self-hoster: os placeholders `<seu-dominio>` e `<dir-de-deploy>` estão explicados e o documento continua executável
- [ ] Cadastrar os secrets `ACME_RESOLVER` (valor atual: o resolver do Traefik da VPS) e `DEPLOY_DIR` (valor atual: `~/programeai/prod/crm`) em Settings → Secrets and variables → Actions
- [ ] Rodar o workflow **Deploy na VPS** com `tag: latest` e confirmar que passa no step "Conferir configuração da VPS", que o site continua no ar e que o certificado TLS não foi reemitido nem invalidado
- [ ] Guardar fora do repositório o runbook com as particularidades da VPS (resolver, diretório, host do Grafana)

**⏸ PAUSE**: A verificação manual desta fase inclui um deploy real. Confirme que
`crm.programeai.com.br` responde com HTTPS válido antes de seguir para a Fase 2.

---

## Phase 2: Borda HTTP — IP real, throttler por cliente, `helmet` e hard-fail da senha da role

### Goal

Fazer o rate limit e o captcha enxergarem o cliente de verdade, adicionar cabeçalhos de
segurança nas respostas da API e impedir que a instância suba com a senha de banco que
passa a ser pública.

### Changes

#### Contrato de ambiente

**Modify**: `apps/api/src/config/env.validation.ts`

Depois de `COOKIE_DOMAIN` (L15), seguindo o padrão de comentário em pt-BR explicando o
papel da variável:

```typescript
  COOKIE_DOMAIN: Joi.string().default('localhost'),
  // Quantidade de proxies confiáveis à frente da API (`trust proxy` do Express).
  // É o que faz req.ip ser o IP do cliente e não o do proxy — e req.ip é a chave
  // do rate limit (ThrottlerGuard) e o `remoteip` enviado ao Turnstile.
  //   1 → topologia padrão: só o reverse proxy do host (Traefik).
  //   0 → API exposta direto, sem proxy nenhum na frente.
  //   2 → CDN + proxy (ex.: Cloudflare na frente do Traefik).
  // Nunca use um valor maior do que a quantidade real de saltos: o excedente
  // passa a confiar em `x-forwarded-for` escrito pelo próprio cliente.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1),
```

#### Bootstrap

**Modify**: `apps/api/src/main.ts:48-53`

`app.set` precisa vir antes de qualquer middleware ler `req.ip`.

```typescript
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  // Atrás de um reverse proxy, a conexão TCP vem do proxy: sem isto req.ip é o
  // IP do container do Traefik, e como o getTracker default do ThrottlerGuard é
  // `return req.ip`, o @Throttle de /auth/* viraria um balde ÚNICO compartilhado
  // por todos os clientes — 5 logins/min derrubariam o login de todo mundo. O
  // mesmo req.ip vai como `remoteip` ao Turnstile.
  app.getHttpAdapter()
    .getInstance()
    .set('trust proxy', config.get<number>('TRUST_PROXY_HOPS') ?? 1);
  // A API responde em /api, que o Traefik roteia DIRETO ao Nest: estas respostas
  // não passam pelo nginx do front (apps/web/nginx.conf) e sairiam sem cabeçalho
  // de segurança algum. O CSP default do helmet é inócuo numa API que só devolve
  // JSON, e não conflita com o CSP do front — são caminhos diferentes (/ vs /api).
  app.use(helmet());
  // Primeiro middleware da cadeia: define o requestId que todas as linhas de log
  // daquele acesso (inclusive as do próprio Nest) vão carregar.
  app.use(contextoDaRequisicao);
  app.use(cookieParser());
```

E o import no topo, junto dos demais:

```typescript
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
```

**Dependency**: `pnpm --filter api add helmet`

O `pnpm-lock.yaml` **precisa** ir no mesmo commit: os Dockerfiles rodam
`pnpm install --frozen-lockfile` e o build quebra sem ele.

#### Log de acesso — uma fonte de verdade para o IP

**Modify**: `apps/api/src/shared/logging/request-context.middleware.ts:47-56`

A função sai inteira. Com `trust proxy` configurado, o Express já resolveu o IP, e ler o
header de novo aqui criaria uma segunda fonte de verdade — pior, uma que aceita valor
forjado justamente na configuração em que não há proxy na frente.

```typescript
function nivelPeloStatus(status: number): NivelLog {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function contextoDaRequisicao(
```

**Modify**: `apps/api/src/shared/logging/request-context.middleware.ts:86`

```typescript
      // req.ip já é o IP do cliente: o bootstrap configura `trust proxy` a partir
      // de TRUST_PROXY_HOPS (ver main.ts), então o Express deriva do
      // `x-forwarded-for` escrito pelo proxy. É o mesmo valor que o rate limit usa.
      ip: req.ip,
```

**Modify**: `apps/api/src/shared/logging/request-context.middleware.ts:1-15`

O bloco de doc do arquivo não menciona IP; nada a mudar ali. O que muda é o comentário
que a função carregava — já removido acima.

**Modify**: `apps/api/src/shared/logging/request-context.middleware.spec.ts:118-130`

O teste antigo fixava o contrato oposto. A requisição falsa não passa pelo Express, então
o que se testa agora é que o log usa `req.ip` — e que um `x-forwarded-for` **não**
sobrescreve isso por conta própria dentro do middleware.

```typescript
  it('loga o IP que o Express resolveu em req.ip, não o cabeçalho cru', () => {
    // Em produção req.ip já vem do x-forwarded-for, porque o bootstrap configura
    // `trust proxy` (TRUST_PROXY_HOPS). O middleware não interpreta o cabeçalho:
    // ler de novo aqui seria uma segunda fonte de verdade para o mesmo dado.
    const res = respostaFalsa(200);
    contextoDaRequisicao(
      requisicaoFalsa('/api/v1/x', {
        'x-forwarded-for': '203.0.113.7, 172.18.0.2',
      }),
      res,
      jest.fn(),
    );
    res.disparaFinish();

    expect(linhas[0].ip).toBe('10.0.0.1');
  });
```

#### Compose e contrato de env

**Modify**: `docker-compose.prod.yml` — no bloco `environment` do serviço `api`, depois de
`COOKIE_DOMAIN`

```yaml
      COOKIE_DOMAIN: ${CRM_DOMAIN}
      # 1 salto = só o Traefik. Ver .env.example para outras topologias.
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-1}
```

**Modify**: `.env.example` — no bloco `--- Reverse proxy / TLS ---` criado na Fase 1

```bash
# Quantidade de proxies confiáveis à frente da API. 1 = só o Traefik (default).
# Use 0 se a API estiver exposta direto e 2 se houver CDN antes do Traefik.
# Valor maior do que a realidade permite ao cliente forjar o próprio IP e furar
# o rate limit de /auth/*.
TRUST_PROXY_HOPS=1
```

**Modify**: `.github/workflows/deploy.yml` — `TRUST_PROXY_HOPS` é opcional (tem default no
compose), então **não** entra no pré-flight. Adicionar ao `envs` e ao heredoc só se você
quiser poder mudar o valor por secret; caso contrário o default de `1` basta e o
`deploy.yml` fica intocado nesta fase.

#### Hard-fail da senha da role

**Modify**: `apps/api/docker/entrypoint.sh:51-53`

Segue exatamente o padrão de fail-fast já usado na L40-47 do mesmo arquivo.

```sh
else
  echo "!! APP_DB_PASSWORD não definida." >&2
  echo "   Sem ela a role crm_app fica com a senha de desenvolvimento gravada" >&2
  echo "   pela migration — que é pública neste repositório." >&2
  echo "   Gere com: openssl rand -hex 32   (sem apóstrofo nem barra invertida)" >&2
  exit 1
fi
```

O entrypoint só existe na imagem de produção; o desenvolvimento local usa `pnpm dev` e
não passa por aqui. Um `APP_DB_PASSWORD` vazio já deixaria a `APP_DATABASE_URL` do compose
sem senha, então a alternativa ao hard-fail não é "funcionar", é "falhar mais tarde e de
forma mais confusa".

#### Documentação

**Modify**: `docs/observabilidade.md:158-160`

A nota afirmava o contrário do que passa a valer.

```markdown
- **`ip` é o IP do cliente**, derivado do `x-forwarded-for` pelo próprio Express
  (`trust proxy`, configurado a partir de `TRUST_PROXY_HOPS` — ver `main.ts`). É
  o mesmo valor que o rate limit usa como chave, então o campo `ip` do log e o
  429 do throttler falam do mesmo cliente.
```

**Modify**: `docs/deploy.md`, seção "O que acontece a cada start da API"

```markdown
2. `ALTER ROLE crm_app` com a `APP_DB_PASSWORD` — a migration
   `20260724040000_create_app_role` cria a role com senha de desenvolvimento, e
   é aqui que ela passa a valer a senha real de produção. **Sem
   `APP_DB_PASSWORD` o boot aborta**: seguir em frente deixaria o banco com a
   senha de desenvolvimento, que é pública neste repositório.
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — suíte verde, incluindo o teste reescrito do middleware
- [ ] `pnpm --filter api build` — compila com o import e a tipagem do `helmet`
- [ ] `grep -n '"helmet"' apps/api/package.json` e `grep -c helmet pnpm-lock.yaml` — dependência e lockfile no mesmo commit
- [ ] `! grep -rn "ipDoCliente" apps/api/src` — a função saiu por completo
- [ ] `sh -n apps/api/docker/entrypoint.sh` — o script continua válido
- [ ] `APP_DB_PASSWORD= sh -c 'set -e; ...'` — ou, mais simples: rodar o entrypoint num container com `APP_DB_PASSWORD` vazia e conferir `exit 1` com a mensagem em pt-BR

#### Manual Verification
- [ ] Local, com `TRUST_PROXY_HOPS=1`: `curl -H 'x-forwarded-for: 203.0.113.7' localhost:3000/api/v1/health` e conferir no log que `ip` é `203.0.113.7`
- [ ] Local: seis `POST /api/v1/auth/login` com `x-forwarded-for: 1.1.1.1` retornam 429 no sexto; em seguida um com `x-forwarded-for: 2.2.2.2` retorna 401 (e **não** 429) — os baldes são independentes
- [ ] Local, com `TRUST_PROXY_HOPS=0`: o `x-forwarded-for` é ignorado e `ip` volta a ser o IP da conexão
- [ ] Após deploy: `curl -sD - -o /dev/null https://crm.programeai.com.br/api/v1/health` mostra `x-content-type-options`, `x-frame-options` e `strict-transport-security` vindos do helmet
- [ ] Após deploy: no Grafana, `{stack="crm", service="api"} | json | evento="http.requisicao"` mostra IPs de clientes distintos, não um IP de container repetido
- [ ] Após deploy: o login de um usuário real continua funcionando (a mudança de tracker é a única alteração de comportamento visível)

**⏸ PAUSE**: Esta fase muda o comportamento de rate limit para usuários reais e exige
deploy. Confirme os itens manuais antes de seguir para a Fase 3.

---

## Phase 3: Gate de autocadastro (`REGISTRATION_ENABLED`)

### Goal

Poder fechar o autocadastro da instância de produção sem quebrar a autohospedagem do zero
nem o convite de colaborador, e sem deixar o frontend oferecendo o que a API recusa.

### Changes

#### Contrato de ambiente

**Modify**: `apps/api/src/config/env.validation.ts`

Depois do bloco de captcha (L25-26), seguindo o padrão do `BILLING_ENABLED`:

```typescript
  TURNSTILE_SECRET_KEY: Joi.string().allow('').default(''),
  // Autocadastro público. Default `true` para não travar quem sobe o projeto do
  // zero: com o cadastro fechado a primeira conta seria impossível de criar (não
  // há seed de admin em produção). Numa instância já em uso, `false` fecha as
  // DUAS portas de autocadastro — POST /auth/register e a criação de conta nova
  // pelo OAuth. O convite de colaborador é do owner e não é afetado.
  REGISTRATION_ENABLED: Joi.boolean().default(true),
```

#### Regra de negócio

**Modify**: `apps/api/src/modules/auth/auth.service.ts`

Imports e logger:

```typescript
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
```

```typescript
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
```

O gate, junto dos outros helpers privados (perto de `assertActive`, L100-107):

```typescript
  /**
   * Freio do autocadastro. Cobre os dois caminhos que criam conta por conta
   * própria: `register()` e o ramo de criação do `oauthLogin()`. Não cobre — e
   * não deve cobrir — o convite de colaborador, que é uma ação deliberada do
   * owner e passa pelo CollaboratorsService, não por aqui.
   */
  private assertRegistrationEnabled() {
    if (this.config.get<boolean>('REGISTRATION_ENABLED') === false) {
      // Sem e-mail no log: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'cadastro.bloqueado',
        msg: 'Tentativa de autocadastro com REGISTRATION_ENABLED=false.',
      });
      throw new ForbiddenException(
        'O autocadastro está desativado nesta instância. Peça um convite ao responsável pela conta.',
      );
    }
  }
```

Chamada em `register()` — antes de qualquer consulta ao banco:

```typescript
  async register(name: string, email: string, password: string) {
    this.assertRegistrationEnabled();
    const existing = await this.users.findByEmail(email);
```

Chamada em `oauthLogin()` — imediatamente antes de criar a conta, **depois** dos ramos de
login e de vínculo por e-mail, para que quem já tem conta continue entrando pelo OAuth:

```typescript
    this.assertRegistrationEnabled();
    const created = await this.users.createWithOAuth({
      name: profile.name,
      email: profile.email,
      provider,
      providerAccountId: profile.providerAccountId,
    });
    return this.issueTokens(created.id);
```

#### Fronteira HTTP

**Modify**: `apps/api/src/modules/auth/auth.controller.ts`

Novo endpoint público, no mesmo espírito do `GET /auth/oauth/providers` (L146-154) —
colocar logo antes dele:

```typescript
  /** Informa se o autocadastro está aberto, para a UI não oferecer o que a API recusa. */
  @Public()
  @Get('registration')
  registration() {
    return {
      enabled: this.config.get<boolean>('REGISTRATION_ENABLED') !== false,
    };
  }
```

**Modify**: `apps/api/src/modules/auth/auth.controller.ts:186-205` (`oauthCallback`)

O `catch` é cego e mandaria um "erro no OAuth" genérico para quem só topou no gate. Um
código próprio deixa a mensagem certa aparecer no login:

```typescript
    } catch (erro) {
      // O gate de cadastro não é falha de OAuth: merece mensagem própria no
      // login, senão o usuário lê "erro no login social" e tenta de novo.
      if (erro instanceof ForbiddenException) {
        return res.redirect(this.frontendError('cadastro_desativado'));
      }
      return res.redirect(this.frontendError('oauth'));
    }
```

com `ForbiddenException` adicionada aos imports de `@nestjs/common` do controller.

#### Frontend

**Create**: `apps/web/src/features/auth/use-registration.ts`

A consulta é usada em duas telas; um hook evita duplicar a chave e o `staleTime`.

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type RegistrationStatus = { enabled: boolean };

/**
 * Se o autocadastro está aberto nesta instância (`REGISTRATION_ENABLED` na API).
 * `undefined` enquanto carrega — quem consome trata isso como "ainda não sei" e
 * não pisca a tela de bloqueio.
 */
export function useRegistrationEnabled(): boolean | undefined {
  const { data } = useQuery<RegistrationStatus>({
    queryKey: queryKeys.auth.registration,
    queryFn: async () => (await api.get('/auth/registration')).data,
    staleTime: 5 * 60 * 1000,
  });
  return data?.enabled;
}
```

**Modify**: `apps/web/src/lib/query-keys.ts:71-74`

```typescript
  auth: {
    oauthProviders: ['auth', 'oauth-providers'] as const,
    registration: ['auth', 'registration'] as const,
    me: ['auth', 'me'] as const,
  },
```

**Modify**: `apps/web/src/features/auth/RegisterPage.tsx`

Estado de bloqueio antes do formulário. A rota continua registrada — quem chegar por link
antigo vê uma explicação, não um formulário que falha no submit.

```tsx
import { useRegistrationEnabled } from './use-registration';
```

Dentro do componente, depois dos hooks e antes do `return` do formulário:

```tsx
  const registrationEnabled = useRegistrationEnabled();

  // `undefined` = ainda carregando: não pisca a tela de bloqueio.
  if (registrationEnabled === false) {
    return (
      <AuthLayout
        title="Cadastro fechado"
        description="Esta instância do CRM não aceita novos cadastros."
      >
        <p className="text-sm text-muted-foreground">
          O acesso é criado pelo responsável pela conta. Se você deveria ter
          acesso, peça um convite — ele chega por e-mail com um link de
          ativação.
        </p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem uma conta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </AuthLayout>
    );
  }
```

**Modify**: `apps/web/src/features/auth/LoginPage.tsx:126-132`

O convite para criar conta só aparece quando criar conta é possível.

```tsx
      <OAuthButtons />
      {registrationEnabled !== false && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Não tem uma conta?{' '}
          <Link to="/registrar" className="font-medium text-primary hover:underline">
            Criar conta
          </Link>
        </p>
      )}
```

com `const registrationEnabled = useRegistrationEnabled();` junto dos outros hooks e o
import de `./use-registration`.

**Modify**: `apps/web/src/features/auth/LoginPage.tsx` — mapa `OAUTH_ERRORS`

```tsx
  cadastro_desativado:
    'Esta instância não aceita novos cadastros. Peça um convite ao responsável pela conta.',
```

#### Compose e contrato de env

**Modify**: `docker-compose.prod.yml` — no `environment` do serviço `api`

```yaml
      TURNSTILE_SECRET_KEY: ${TURNSTILE_SECRET_KEY}
      # false fecha o autocadastro (register + criação de conta nova por OAuth).
      REGISTRATION_ENABLED: ${REGISTRATION_ENABLED:-true}
```

**Modify**: `.github/workflows/deploy.yml`

`REGISTRATION_ENABLED` entra no `envs`, no mapeamento de `env` do step e no heredoc do
`.env`, junto de `BILLING_ENABLED` — é o secret que efetivamente fecha o cadastro da
produção.

**Modify**: `.env.example` — bloco novo depois do de captcha

```bash
# --- Autocadastro ---
# true (default) permite criar conta em /registrar e criar conta nova via OAuth.
# false fecha as duas portas: o acesso passa a ser só por convite de colaborador.
# Mantenha true no primeiro boot de uma instância nova — sem isso não há como
# criar a primeira conta (não existe seed de admin em produção).
REGISTRATION_ENABLED=true
```

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — novo endpoint antes de `### GET /auth/oauth/providers`

```markdown
### GET /auth/registration
- **Propósito:** Informar se o autocadastro está aberto nesta instância, para a UI não oferecer a tela de registro quando a API vai recusar.
- **Auth:** Pública (`@Public()`).
- **Body:** —
- **Resposta:** `200 { enabled: boolean }` — reflete `REGISTRATION_ENABLED` (default `true`).
- **Erros:** —
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.registration`
```

**Modify**: `apps/api/ENDPOINTS.md`, `### POST /auth/register` — linha de erros

```markdown
- **Erros:** `403 O autocadastro está desativado nesta instância. Peça um convite ao responsável pela conta.` (`REGISTRATION_ENABLED=false`); `409 Já existe uma conta com este e-mail.`; `400 Confirme que você não é um robô.` / `400 Falha na verificação do captcha. Tente novamente.` (captcha); `400` (validação).
```

**Modify**: `apps/api/ENDPOINTS.md`, `### GET /auth/oauth/:provider/callback` — linha de erros

```markdown
- **Erros:** `302 → {FRONTEND_URL}/login?error=oauth` (state inválido, falha na troca, ou e-mail não verificado); `302 → {FRONTEND_URL}/login?error=cadastro_desativado` (e-mail desconhecido com `REGISTRATION_ENABLED=false`).
```

**Modify**: `docs/deploy.md:162-164` — o aviso vira instrução

```markdown
> **Depois de criar sua conta**, feche o autocadastro: cadastre o secret
> `REGISTRATION_ENABLED=false` e rode um novo deploy. Isso fecha `/registrar` e
> a criação de conta nova por OAuth; o acesso de novas pessoas passa a ser por
> convite de colaborador. Deixar aberto significa que qualquer um com o endereço
> da instância cria conta — o captcha (`TURNSTILE_SECRET_KEY`) reduz o abuso
> automatizado, mas não é um controle de acesso.
```

#### Testes

**Modify**: `apps/api/src/modules/auth/auth.service.spec.ts`

O mock de `ConfigService` hoje é `get: jest.fn().mockReturnValue('x')` — `'x'` não é
`false`, então os testes existentes continuam passando sem mudança. Para os casos novos, o
mock precisa responder por chave. Extrair uma fábrica no `beforeEach`:

```typescript
    const valoresDeConfig: Record<string, unknown> = {};
    const config = {
      get: jest.fn((chave: string) =>
        chave in valoresDeConfig ? valoresDeConfig[chave] : 'x',
      ),
    } as unknown as ConfigService;
```

expondo `valoresDeConfig` no escopo do `describe` para os testes ajustarem. Casos novos:

```typescript
  describe('gate de autocadastro', () => {
    it('recusa register com ForbiddenException quando REGISTRATION_ENABLED=false', async () => {
      valoresDeConfig.REGISTRATION_ENABLED = false;
      await expect(
        service.register('Nome', 'a@b.com', 'senha123'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Barra antes de tocar o banco: nem consulta de e-mail duplicado acontece.
      expect(users.findByEmail).not.toHaveBeenCalled();
    });

    it('permite register quando a flag está ausente (default true)', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue({ id: 'u1' } as any);
      await expect(
        service.register('Nome', 'a@b.com', 'senha123'),
      ).resolves.toMatchObject({ accessToken: 'token' });
    });

    it('recusa a criação de conta nova por OAuth quando o cadastro está fechado', async () => {
      valoresDeConfig.REGISTRATION_ENABLED = false;
      users.findByProviderAccount.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.oauthLogin(OAuthProvider.GOOGLE, {
          providerAccountId: 'g1',
          email: 'a@b.com',
          emailVerified: true,
          name: 'Nome',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(users.createWithOAuth).not.toHaveBeenCalled();
    });

    it('deixa quem já tem conta entrar por OAuth mesmo com o cadastro fechado', async () => {
      valoresDeConfig.REGISTRATION_ENABLED = false;
      users.findByProviderAccount.mockResolvedValue({
        id: 'u1',
        active: true,
      } as any);
      await expect(
        service.oauthLogin(OAuthProvider.GOOGLE, {
          providerAccountId: 'g1',
          email: 'a@b.com',
          emailVerified: true,
          name: 'Nome',
        }),
      ).resolves.toMatchObject({ accessToken: 'token' });
    });
  });
```

O mock de `users` precisa ganhar `create`, `createWithOAuth`, `findByProviderAccount` e
`linkOAuthAccount` no `Pick<...>` e no objeto do `beforeEach`.

**Modify**: `apps/api/src/modules/collaborators/application/collaborators.service.spec.ts`

Um teste que fixa a fronteira — o convite não passa pelo gate:

```typescript
  it('cria colaborador por convite mesmo com o autocadastro fechado', async () => {
    // Contrato explícito: REGISTRATION_ENABLED só freia AUTOcadastro. Convite é
    // ação deliberada do owner e não passa pelo AuthService.
    // (o CollaboratorsService não lê REGISTRATION_ENABLED em lugar nenhum)
    ...
  });
```

> Nota para o /code: adaptar ao shape real dos mocks desse spec, que já existe. O valor
> do teste é documentar a fronteira; se ele ficar artificial no arranjo atual, um
> comentário no `assertRegistrationEnabled` apontando o `CollaboratorsService` cumpre o
> mesmo papel — decida ao ler o arquivo.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — os quatro casos novos passam e a suíte existente segue verde
- [ ] `pnpm --filter api build` e `pnpm --filter web build` — compilam
- [ ] `pnpm --filter web lint` — oxlint limpo
- [ ] `grep -n "REGISTRATION_ENABLED" apps/api/src/config/env.validation.ts docker-compose.prod.yml .env.example .github/workflows/deploy.yml` — a variável está declarada nos quatro lugares
- [ ] `grep -n "GET /auth/registration" apps/api/ENDPOINTS.md` — doc do endpoint no mesmo commit (exigência do `apps/api/CLAUDE.md`)
- [ ] `! grep -rn "email" apps/api/src/modules/auth/auth.service.ts | grep -n "evento: 'cadastro.bloqueado'" -A3` — o log do gate não carrega e-mail

#### Manual Verification
- [ ] Local com `REGISTRATION_ENABLED=false`: `/registrar` mostra "Cadastro fechado" e o link "Criar conta" desaparece do login
- [ ] Local com `REGISTRATION_ENABLED=false`: `POST /api/v1/auth/register` responde `403` com a mensagem em pt-BR
- [ ] Local com `REGISTRATION_ENABLED=false`: OAuth com e-mail **desconhecido** volta ao login com o toast "Esta instância não aceita novos cadastros…"; OAuth com e-mail **já cadastrado** entra normalmente
- [ ] Local com `REGISTRATION_ENABLED=false`: criar um colaborador pelo painel e **aceitar o convite** funciona de ponta a ponta
- [ ] Local sem a variável definida: `/registrar` funciona (default `true` protege a autohospedagem do zero)
- [ ] Após deploy com `REGISTRATION_ENABLED=false`: conferir no Grafana que `evento="cadastro.bloqueado"` aparece na primeira tentativa e que a linha não contém e-mail

**⏸ PAUSE**: Confirme os itens manuais — em especial o do convite de colaborador — antes
de seguir para a Fase 4.

---

## Phase 4: Arquivos de comunidade

### Goal

Dar ao repositório público os canais que o GitHub espera: reporte de vulnerabilidade,
código de conduta, templates de issue e PR, e atualização automática de dependências.

### Changes

**Create**: `.github/SECURITY.md`

```markdown
# Política de Segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública para falha de segurança.**

Use o reporte privado do GitHub:
[Report a vulnerability](https://github.com/programeai/CRM/security/advisories/new).
O relato chega como advisory privado, visível só para os mantenedores, e é o
canal com o melhor histórico de resposta.

Ao reportar, inclua se possível: versão ou commit afetado, passos para
reproduzir, impacto observado e qualquer log ou requisição relevante (sem
credenciais reais).

## Prazo de resposta

Este é um projeto mantido por uma equipe pequena. O compromisso é confirmar o
recebimento em até **7 dias** e informar o encaminhamento (correção, mitigação
ou recusa) em até **30 dias**. Não há programa de recompensa (bug bounty).

## Escopo

Vale para o código deste repositório: a API (`apps/api`), o frontend
(`apps/web`), os Dockerfiles e os workflows.

**Fora de escopo:** a instância hospedada em `crm.programeai.com.br` e a
infraestrutura em volta dela; instâncias autohospedadas por terceiros; e
comportamento que dependa de má configuração da própria instância — por exemplo
`REGISTRATION_ENABLED=true` com `TURNSTILE_SECRET_KEY` vazia, que é uma escolha
documentada de quem opera, não um defeito do código.

## Versões suportadas

Só a `main`. Não há releases com suporte estendido.
```

**Create**: `.github/CODE_OF_CONDUCT.md`

Contributor Covenant 2.1, tradução pt-BR oficial, com `edson@solarz.com.br` como contato
de reporte. Preservar a atribuição e o link para o original
(`https://www.contributor-covenant.org/pt-br/version/2/1/code_of_conduct/`), que é
requisito da licença CC BY 4.0 do texto.

**Create**: `.github/PULL_REQUEST_TEMPLATE.md`

Espelha o que o `CONTRIBUTING.md` já cobra, para o autor conferir antes de pedir revisão.

```markdown
## O que muda

<!-- Uma ou duas frases: o que este PR faz e por quê. -->

## Como testar

<!-- Passos para verificar. Se houver UI, inclua print ou gif. -->

## Checklist

- [ ] Toda mensagem visível ao usuário está em **pt-BR** (validações, toasts,
      exceções da API, textos de UI)
- [ ] Nenhum enum de domínio aparece cru na interface (traduzido em `apps/web/src/lib/labels.ts`)
- [ ] Se mexi em controller, atualizei `apps/api/ENDPOINTS.md` neste mesmo PR
- [ ] Log novo usa `Logger`/`registrarLog` com `evento` em pt-BR, sem segredo e
      sem dado pessoal — nunca `console.log`
- [ ] `pnpm --filter api test` e `pnpm --filter api build` passam
- [ ] Mudança de modelo de dados começou em `prisma/schema.prisma` com migration
```

**Create**: `.github/ISSUE_TEMPLATE/config.yml`

```yaml
blank_issues_enabled: false
contact_links:
  - name: Falha de segurança
    url: https://github.com/programeai/CRM/security/advisories/new
    about: Vulnerabilidades vão por reporte privado, nunca por issue pública.
  - name: Dúvida ou ideia
    url: https://github.com/programeai/CRM/discussions
    about: Perguntas e propostas em aberto ficam melhor em Discussions.
```

> Requer habilitar Discussions no repositório; se preferir não habilitar, remova esse
> segundo item.

**Create**: `.github/ISSUE_TEMPLATE/bug.yml`

```yaml
name: Bug
description: Algo não funciona como deveria
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Falha de **segurança** não vai aqui — use o
        [reporte privado](https://github.com/programeai/CRM/security/advisories/new).
  - type: textarea
    id: descricao
    attributes:
      label: O que acontece
      description: Descreva o comportamento observado.
    validations:
      required: true
  - type: textarea
    id: esperado
    attributes:
      label: O que deveria acontecer
    validations:
      required: true
  - type: textarea
    id: reproducao
    attributes:
      label: Como reproduzir
      placeholder: |
        1. Entrar em …
        2. Clicar em …
        3. Ver o erro …
    validations:
      required: true
  - type: input
    id: versao
    attributes:
      label: Versão ou commit
      placeholder: "main @ 992b507"
  - type: dropdown
    id: ambiente
    attributes:
      label: Ambiente
      options:
        - Desenvolvimento local (pnpm dev)
        - Autohospedagem (docker-compose.prod.yml)
        - Instância hospedada (crm.programeai.com.br)
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Log ou x-request-id
      description: >
        Toda resposta da API traz o cabeçalho `x-request-id`. Cole-o aqui, ou o
        trecho de log relevante — **sem senha, token ou cookie**.
      render: text
```

**Create**: `.github/ISSUE_TEMPLATE/feature.yml`

```yaml
name: Melhoria
description: Sugerir uma funcionalidade ou mudança
labels: [enhancement]
body:
  - type: textarea
    id: problema
    attributes:
      label: Qual problema isso resolve
      description: Comece pelo problema, não pela solução.
    validations:
      required: true
  - type: textarea
    id: proposta
    attributes:
      label: Proposta
    validations:
      required: true
  - type: textarea
    id: alternativas
    attributes:
      label: Alternativas consideradas
  - type: checkboxes
    id: escopo
    attributes:
      label: Escopo do produto
      description: >
        O CRM é single-tenant, de agência (clientes, pipeline, propostas,
        projetos, contratos e financeiro).
      options:
        - label: Li o escopo de produto no README e a proposta cabe nele
          required: true
```

**Create**: `.github/dependabot.yml`

```yaml
# Atualização automática de dependências. Três ecossistemas:
#   npm            → pnpm workspace com lockfile único na raiz (directory "/")
#   docker         → imagens base dos Dockerfiles e dos composes
#   github-actions → as actions pinadas em build.yml e deploy.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 5
    # Um PR por grupo em vez de um por pacote: o volume de patch/minor em
    # NestJS + React sozinho abriria dezenas de PRs por mês.
    groups:
      producao:
        applies-to: version-updates
        dependency-type: production
        update-types: [minor, patch]
      desenvolvimento:
        applies-to: version-updates
        dependency-type: development
        update-types: [minor, patch]
    commit-message:
      prefix: "chore(deps)"

  - package-ecosystem: docker
    directories:
      - "/apps/api"
      - "/apps/web"
      - "/"
    schedule:
      interval: monthly
    commit-message:
      prefix: "chore(deps)"

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: monthly
    commit-message:
      prefix: "chore(ci)"
```

> Confirmar os caminhos dos Dockerfiles antes de commitar (`apps/api/Dockerfile` e
> `apps/web/Dockerfile` esperados) e incluir `/` só se algum compose declarar `image:`
> com tag fixa que valha atualizar — `postgres:16-alpine` no `docker-compose.prod.yml`
> vale.

**Modify**: `CONTRIBUTING.md`

Duas seções novas no fim, e um ponteiro no topo:

```markdown
## Código de conduta

Este projeto adota o [Código de Conduta](./.github/CODE_OF_CONDUCT.md)
(Contributor Covenant 2.1). Participar significa concordar com ele.

## Falhas de segurança

**Não abra issue pública.** Use o
[reporte privado de vulnerabilidade](https://github.com/programeai/CRM/security/advisories/new)
— detalhes em [SECURITY.md](./.github/SECURITY.md).
```

**Modify**: `README.md` — na seção "Contribuindo"

```markdown
## Contribuindo
Ver [CONTRIBUTING.md](./CONTRIBUTING.md) e o
[Código de Conduta](./.github/CODE_OF_CONDUCT.md).
Falha de segurança vai por [reporte privado](./.github/SECURITY.md), nunca em issue.
```

### Success Criteria

#### Automated Verification
- [ ] `for f in .github/dependabot.yml .github/ISSUE_TEMPLATE/*.yml; do python3 -c "import yaml,sys; yaml.safe_load(open('$f'))" || exit 1; done` — todos os YAML são válidos
- [ ] `test -f .github/SECURITY.md && test -f .github/CODE_OF_CONDUCT.md && test -f .github/PULL_REQUEST_TEMPLATE.md` — arquivos no lugar
- [ ] `grep -rn "Edsonalencar" .github/ CONTRIBUTING.md README.md` não retorna nada — todas as URLs usam `programeai/CRM`
- [ ] `grep -rn "contributor-covenant.org" .github/CODE_OF_CONDUCT.md` — atribuição da CC BY 4.0 preservada
- [ ] `git log --oneline -1 --name-only` mostra que o push não disparou o build (todos os caminhos estão no `paths-ignore` do `build.yml:22-35`)

#### Manual Verification
- [ ] Habilitar **Private vulnerability reporting** em Settings → Code security, e conferir que a URL do `SECURITY.md` abre o formulário
- [ ] Habilitar **Discussions** (ou remover o contact link do `config.yml`)
- [ ] Abrir uma issue de teste em cada template e confirmar que os campos obrigatórios funcionam e o texto está em pt-BR
- [ ] Conferir que a aba **Security** do repositório mostra a política, e que o Insights → Community Standards fica sem pendência
- [ ] Depois de tornar o repo público: conferir que o Dependabot abriu (ou está agendado) o primeiro lote de PRs agrupados

**⏸ PAUSE**: Última fase. Confirme os passos manuais de configuração do repositório —
eles não são versionáveis e são o que faz os arquivos desta fase funcionarem.

---

## Testing Strategy

### Unit Tests

- `apps/api/src/shared/logging/request-context.middleware.spec.ts` — o teste que fixava
  "prefere o IP do x-forwarded-for" é **reescrito**, não removido: passa a fixar o
  contrato novo (o middleware usa `req.ip` e não interpreta o cabeçalho). Sem essa
  reescrita a suíte quebra e o portão de qualidade do `build.yml` barra o deploy.
- `apps/api/src/modules/auth/auth.service.spec.ts` — quatro casos do gate: `register`
  bloqueado, `register` liberado por default, criação por OAuth bloqueada, e **login por
  OAuth de quem já tem conta liberado mesmo com o cadastro fechado**. Esse último é o que
  impede uma regressão que trancaria usuários existentes fora da própria conta.
- `apps/api/src/modules/collaborators/application/collaborators.service.spec.ts` — fixa a
  fronteira do gate (convite ≠ autocadastro).
- Casos de borda a cobrir: `TRUST_PROXY_HOPS=0` (cabeçalho ignorado),
  `REGISTRATION_ENABLED` ausente (default `true`), e `assertRegistrationEnabled` barrando
  **antes** de qualquer I/O.

### Integration Tests

Não há suíte e2e ativa neste repositório (`test:e2e` existe no `package.json` mas sem
casos relevantes ao fluxo de auth). Os fluxos cruzados ficam na verificação manual, que
por isso é explícita e obrigatória em cada fase. Os dois que mais importam:

1. **Rate limit por cliente** — dois `x-forwarded-for` distintos precisam ter baldes
   independentes. É a única prova de que a Fase 2 atingiu o objetivo.
2. **Convite de colaborador com cadastro fechado** — criar colaborador, receber o link,
   aceitar e entrar, tudo com `REGISTRATION_ENABLED=false`.

### Migration & Rollback

Nenhuma migration de banco nesta spec. A rollback story é a que já existe:

- **Fase 1** — só docs, metadados e workflow. Rollback é `git revert`. Atenção: se os
  secrets `ACME_RESOLVER`/`DEPLOY_DIR` já foram cadastrados, o revert volta a versão que
  ignora ambos e o comportamento anterior é restaurado; os secrets ficam órfãos, sem
  efeito colateral.
- **Fases 2 e 3** — rollback é rodar o workflow **Deploy na VPS** com `tag` = SHA do
  commit bom (ver `docs/deploy.md` → Rollback). Nenhuma migration é aplicada, então voltar
  a imagem basta.
- **Reversão sem deploy**, se preciso: `REGISTRATION_ENABLED` e `TRUST_PROXY_HOPS` são
  runtime. Trocar o valor no `.env` da VPS e `docker compose up -d` desfaz o efeito de
  qualquer uma das duas sem voltar imagem. O hard-fail do entrypoint é a única mudança da
  Fase 2 que só se desfaz por imagem.
- **Ordem obrigatória na Fase 1:** cadastrar os secrets **antes** de rodar o deploy. O
  pré-flight falha no runner sem eles, então o pior caso é um dispatch que não faz nada.

## Environment Considerations

- **CI/CD** — Fases 1 e 4 caem inteiras no `paths-ignore` do `build.yml:22-35`
  (`**/*.md`, `docs/`, `.github/`, `.env.example`, os composes): zero minuto de Actions.
  Fases 2 e 3 tocam `apps/api/**`, `apps/web/**` e o `pnpm-lock.yaml` — o build dispara e
  reconstrói as duas imagens (o lockfile é caminho compartilhado). Nenhum step novo é
  necessário no `build.yml`.
- **`pnpm-lock.yaml` é obrigatório no commit do `helmet`.** Os Dockerfiles rodam
  `pnpm install --frozen-lockfile`: sem o lockfile atualizado, o build da imagem falha.
- **Migrations** — nenhuma. A migration `create_app_role` **não** é editada (ver
  "What We're NOT Doing").
- **Config/Secrets** — três secrets novos a cadastrar:
  | Secret | Fase | Obrigatório | Valor |
  | --- | --- | --- | --- |
  | `ACME_RESOLVER` | 1 | **sim** (deploy falha sem) | resolver ACME atual do Traefik da VPS |
  | `DEPLOY_DIR` | 1 | **sim** (deploy falha sem) | `~/programeai/prod/crm` |
  | `REGISTRATION_ENABLED` | 3 | não (default `true`) | `false` na produção |
  `TRUST_PROXY_HOPS` não precisa de secret: o default `1` no compose já é o valor correto
  para a topologia atual.
- **Multi-ambiente** — o único diferencial dev/prod é que o `entrypoint.sh` (e portanto o
  hard-fail) só roda na imagem de produção. Em dev, `TRUST_PROXY_HOPS` deve ficar em `0`
  ou ausente com a API acessada direto; se você usa algum proxy local, `1`.
- **`docs/` não vai para a VPS.** O `deploy.yml` copia só o `docker-compose.prod.yml`
  (`scp-action`, `source: "docker-compose.prod.yml"`), então mudanças de doc nunca exigem
  deploy.

## Dependencies & Risks

- **`helmet` é dependência nova** e a única adição de terceiro nesta spec. Risco baixo
  (biblioteca madura, sem dependências transitivas relevantes), mas exige lockfile no
  mesmo commit e faz o build reconstruir as duas imagens.
- **A mudança de tracker do throttler é visível para usuários reais.** Hoje o balde é
  global; depois é por IP. O efeito prático é positivo (ninguém mais derruba o login de
  todos), mas usuários atrás de um mesmo NAT corporativo passam a compartilhar balde entre
  si — com `limit: 5, ttl: 60000` em `/auth/login`, um escritório grande pode topar no
  limite. Monitorar `{stack="crm", service="api"} | json | status=429` depois do deploy;
  se aparecer, o ajuste é o `limit` da rota, não o tracker.
- **`ACME_RESOLVER` sem default é deliberado, e é o único risco de indisponibilidade
  nesta spec.** A mitigação é o pré-flight que falha no runner antes de qualquer SSH: um
  deploy sem o secret não chega a tocar a VPS. Não adicione um default depois — um
  resolver errado sobe o container e derruba o TLS, que é justamente o cenário que o
  pré-flight evita.
- **Ordenação entre Fase 3 e o trabalho de colaboradores no working tree.** A Fase 3
  toca `auth.service.ts` e `auth.controller.ts`, arquivos que a feature de colaboradores
  também modificou. Fazer a Fase 3 **depois** de a feature estar commitada evita conflito;
  se rodarem em paralelo, resolver o conflito é trivial (adições em pontos distintos do
  arquivo).
- **O `CaptchaService` desliga em silêncio** quando `TURNSTILE_SECRET_KEY` está vazia
  (`captcha.service.ts:20-22`). Confirmado que a produção tem a chave preenchida, então
  não há ação nesta rodada — mas o comportamento continua sendo um modo de falha silencioso
  para quem autohospeda. Fora de escopo aqui; candidato a um log de boot em rodada futura.
- **`docs/deploy.md` e `docs/observabilidade.md` perdem precisão para o mantenedor** ao
  ganharem placeholders. O runbook com os valores reais da VPS precisa existir fora do
  repositório antes da Fase 1 ser considerada concluída — senão a informação simplesmente
  se perde.

## References

- PRD: `specs/research/2026-07-25-ajustes-open-source-producao.md`
- Spec anterior (implementada): `specs/plans/2026-07-24-preparar-open-source.md` — trouxe
  `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, README público e os Dockerfiles
- `specs/plans/2026-07-24-billing-stripe.md` — origem do `BILLING_ENABLED`, padrão de
  flag booleana que o `REGISTRATION_ENABLED` segue
- `specs/plans/2026-07-23-rls-por-ownerid.md` — origem da role `crm_app` e da senha de
  desenvolvimento na migration
- `docs/observabilidade.md` — contrato de log estruturado (`evento` em pt-BR)
- `node_modules/@nestjs/throttler/dist/throttler.guard.js:141` — `getTracker` default é
  `return req.ip`, o que dispensa override quando `trust proxy` está configurado
- Contributor Covenant 2.1 (pt-BR):
  https://www.contributor-covenant.org/pt-br/version/2/1/code_of_conduct/
- Dependabot — opções de configuração:
  https://docs.github.com/code-security/dependabot/working-with-dependabot/dependabot-options-reference
