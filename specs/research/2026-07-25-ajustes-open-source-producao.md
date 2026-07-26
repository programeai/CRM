---
date: 2026-07-25T00:00:00-03:00
researcher: claude
git_commit: 992b5075f606fcc108e2a6d252eda3de26537218
branch: main
topic: "Ajustes para tornar o repositório público com a instância já em produção"
tags: [research, open-source, seguranca, throttler, licenca, docs, ci]
status: complete
---

# Research: Ajustes para abrir o repositório com produção no ar

## Research Question

Levantar o que precisa mudar no repositório antes de torná-lo público, considerando que
`crm.programeai.com.br` **já está em produção**. Três frentes:

1. **Bloqueadores de publicação** — typo no `.env.example`, `license: "UNLICENSED"` contraditório
   com a Apache 2.0, vazamento de topologia de infra em `docs/deploy.md`.
2. **Endurecimento de produção** — `trust proxy` ausente quebrando o rate limit por IP, registro
   público sem gate, `APP_DB_PASSWORD` sem hard-fail, ausência de `helmet`.
3. **Higiene open source** — `SECURITY.md`, `CODE_OF_CONDUCT.md`, templates de issue/PR, Dependabot.

## Summary

O repositório é **privado** hoje (`programeai/CRM`, remote `git@github.com:Edsonalencar/CRM.git`) e a
spec `specs/plans/2026-07-24-preparar-open-source.md` já foi **implementada**: existem `LICENSE`
(Apache 2.0 íntegra), `NOTICE`, `CONTRIBUTING.md`, README reescrito com seções de autohospedagem/
licença/trademark, Dockerfiles e `docker-compose.prod.yml`. Aquela spec também registrou uma
auditoria de segredos com resultado limpo. **Uma nova varredura de `git log --all -p` confirma o
resultado**: nenhum padrão de chave real (`sk_live`, `whsec_`, `ghp_`, `AKIA`, `GOCSPX-`, `AIza`,
`BEGIN … PRIVATE KEY`) e nenhum `.env` jamais rastreado. Os únicos "segredos" versionados são valores
de desenvolvimento (`crm_password`, `crm_app_password`, `changeme123`, `dev-access-secret-…`).
**Não há necessidade de reescrita de histórico nem de rotação dos secrets de produção** — eles vivem
apenas como GitHub Secrets, consumidos pelo `deploy.yml`.

O que a spec anterior não cobriu é o efeito de **abrir o código com uma instância viva**: o repo
público passa a documentar o domínio, os endpoints, os limites de rate e o layout do host. Três
achados concretos vêm daí. O mais sério é o rate limit: `main.ts` nunca configura `trust proxy` — e
o `request-context.middleware.ts:50` declara isso como decisão deliberada, justamente para não afetar
o throttler. A consequência é que, atrás do Traefik, `req.ip` é sempre o IP do container do proxy,
então o `@Throttle({ limit: 5, ttl: 60000 })` de `/auth/login` e `/auth/register` é um **balde único
global**, não por cliente. O mesmo `req.ip` é passado como `remoteip` ao Turnstile. Os outros dois:
`POST /auth/register` é público sem gate de primeiro usuário (o `docs/deploy.md:162` já documenta
isso como risco aceito), e o `entrypoint.sh` apenas **avisa** em stderr quando `APP_DB_PASSWORD` está
vazia — seguindo em frente com a senha `'crm_app_password'` que a migration grava e que passará a ser
pública.

Do lado de empacotamento e docs, o alinhamento é quase completo: o `nginx.conf` do front já entrega
CSP/HSTS/X-Frame-Options bem construídos, o `env.validation.ts` (Joi) já é o ponto canônico de
contrato de ambiente, e o `.dockerignore`/`paths-ignore` do `build.yml` já excluem `docs/`, `specs/`
e `.md` do contexto de build. As lacunas são pontuais: metadados de licença nos `package.json` dos
workspaces, um resíduo de find-and-replace no `.env.example`, prosa de infra em `docs/deploy.md` que
cita um projeto de terceiro na mesma VPS, e a ausência total de arquivos de comunidade em `.github/`
(que só contém `workflows/`).

## Codebase Map

### Affected Files & Modules

#### Frente 1 — bloqueadores de publicação

| File | Role | Relevance |
|------|------|-----------|
| `.env.example:54` | Contrato de variáveis de produção (cada uma é um GitHub Secret) | Comentário corrompido: `roteado pelo Trae/api/v1fik até a API` — resíduo de find-and-replace, **mudança não commitada** no working tree |
| `apps/api/package.json:7` | Manifesto do workspace da API | `"license": "UNLICENSED"` contradiz o `LICENSE` Apache 2.0 da raiz |
| `apps/web/package.json:1-6` | Manifesto do workspace do front | Não declara `license` nenhuma |
| `package.json:2-3` | Manifesto da raiz (`"name": "crm"`, `"private": true`) | Também sem `license`; `private: true` é correto e deve permanecer (evita publish acidental no npm) |
| `docs/deploy.md:3` e `docs/deploy.md:33` | Doc de deploy | Duas menções ao projeto de terceiro: *"O CRM roda na mesma VPS do Dorado da Sorte"* (L3) e *"Já atendidos pelo deploy do Dorado"* (L33) — expõem nome de outro projeto e a co-locação |
| `docs/deploy.md:31-38, 166-200` | Pré-requisitos e operação | Expõe `/opt/traefik/traefik.yml`, `factis_resolver`, `~/programeai/prod/crm`, usuário de deploy, comandos de `pg_dump` do host |
| `docs/observabilidade.md:5,137` | Doc de observabilidade | Cita `https://grafana.programeai.com.br` e o host de produção nos exemplos de `curl` |
| `CLAUDE.md` (seção "Ferramentas do monorepo") | Instruções do projeto | Diz "Postgres 16 em `localhost:5432`"; o `docker-compose.yml:11` publica em `5435` e o README já está correto |

#### Frente 2 — endurecimento de produção

| File | Role | Relevance |
|------|------|-----------|
| `apps/api/src/main.ts:50-63` | Bootstrap: middleware de contexto, `cookieParser`, `ValidationPipe`, `enableCors` | Não há `trust proxy` nem `helmet`; é o único ponto onde ambos entrariam |
| `apps/api/src/shared/logging/request-context.middleware.ts:44-56` | `ipDoCliente()` — lê `x-forwarded-for` só para log | Comentário na L50 documenta a decisão de **não** mexer em `trust proxy` "que mudaria o throttler também"; qualquer mudança precisa atualizar esse comentário e o `.spec.ts:118` |
| `apps/api/src/app.module.ts:33` | `ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] })` | Ponto onde uma opção `getTracker` global entraria |
| `apps/api/src/app.module.ts:64` | `{ provide: APP_GUARD, useClass: ThrottlerGuard }` | Ponto onde um guard customizado substituiria o padrão, se a via for herança |
| `apps/api/src/modules/auth/auth.controller.ts:53-67` | `POST /auth/register` — `@Public()`, `@Throttle(5/min)`, `captcha.verify(dto.captchaToken, req.ip)` | Endpoint sem gate; o `req.ip` passado ao Turnstile é o do proxy |
| `apps/api/src/modules/auth/auth.controller.ts:70-82` | `POST /auth/login` — `@Public()`, `@Throttle(5/min)` | Vítima do balde global: 5 tentativas/min derrubam o login de todos |
| `apps/api/src/modules/auth/auth.controller.ts:85-99` | `forgot-password` (3/min) e `reset-password` (5/min) | Mesmo problema de tracker |
| `apps/api/src/modules/auth/auth.service.ts:28-39` | `register()` — só checa e-mail duplicado | Um gate de cadastro precisa passar por aqui **ou** pelo controller |
| `apps/api/src/modules/auth/auth.service.ts:46-75` | `oauthLogin()` — cria conta nova quando o e-mail verificado é desconhecido (`users.createWithOAuth`, L69) | **Segundo caminho de cadastro**: um gate só no `POST /auth/register` deixaria o OAuth aberto |
| `apps/api/src/modules/auth/captcha/captcha.service.ts:20-22` | `isEnabled()` — captcha desliga sozinho se `TURNSTILE_SECRET_KEY` estiver vazia | Em produção é o único freio hoje; vale verificar se está preenchida na VPS |
| `apps/api/src/config/env.validation.ts` | Schema Joi de todas as variáveis | Onde `APP_DB_PASSWORD` e uma eventual flag de cadastro seriam declaradas |
| `apps/api/docker/entrypoint.sh:36-53` | `ALTER ROLE crm_app` com `APP_DB_PASSWORD` | Ramo `else` (L51-53) só imprime aviso em stderr e continua |
| `apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql:10` | `CREATE ROLE crm_app LOGIN PASSWORD 'crm_app_password'` | Senha de dev que passa a ser pública |
| `docker-compose.prod.yml:74-79` | Monta `DATABASE_URL`/`APP_DATABASE_URL` e passa `APP_DB_PASSWORD` | Nenhuma validação de presença no nível do compose |
| `apps/api/package.json` (dependencies) | 21 deps; **`helmet` não está instalado** (`node_modules/helmet` ausente) | Adicionar `helmet` implica `pnpm --filter api add helmet` + lockfile |

#### Frente 3 — higiene open source

| File | Role | Relevance |
|------|------|-----------|
| `.github/` | Contém **apenas** `workflows/` (`build.yml`, `deploy.yml`) | Faltam `SECURITY.md`, `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `dependabot.yml` |
| `CONTRIBUTING.md` | Guia curto: setup, pt-BR, padrão de commit, CLA implícito Apache 2.0 | Existe e está bom; precisará linkar `SECURITY.md` e o código de conduta |
| `.github/workflows/build.yml:22-35` | `paths-ignore` já cobre `**/*.md`, `docs/`, `specs/`, `.claude/`, `.agents/`, `.github/` | Arquivos de comunidade novos **não** vão disparar build — nenhum ajuste necessário |
| `.github/workflows/deploy.yml` | Deploy manual (`workflow_dispatch`) via SSH com 4 secrets | Repo público: o workflow fica visível, mas `workflow_dispatch` não é acionável por não-colaboradores |

### Existing Patterns to Follow

**Pattern: contrato de ambiente centralizado em Joi**

```typescript
// De apps/api/src/config/env.validation.ts:9-11
DATABASE_URL: Joi.string().uri().required(), // crm_user (migrations/seed/crons — superuser, bypassa RLS)
APP_DATABASE_URL: Joi.string().uri().required(), // crm_app (conexão da app — sujeita a RLS)
JWT_ACCESS_SECRET: Joi.string().min(32).required(),
```

**Why this matters**: toda variável nova nasce aqui, com comentário em pt-BR explicando o papel.
Opcionais usam `.allow('').default('')` (ver `TURNSTILE_SECRET_KEY`, L27); obrigatórias usam
`.required()`. É o padrão para declarar `APP_DB_PASSWORD` e uma eventual flag de cadastro.
Atenção: o schema não tem `.unknown(false)`, então variáveis extras passam — mas o
`docker-compose.prod.yml` é o que decide o que chega ao container.

**Pattern: fail-fast com mensagem acionável no entrypoint**

```sh
# De apps/api/docker/entrypoint.sh:40-47
case "$APP_DB_PASSWORD" in
  *"'"*|*'\'*)
    echo "!! APP_DB_PASSWORD não pode conter apóstrofo (') nem barra invertida." >&2
    echo "   Gere com: openssl rand -hex 32" >&2
    exit 1
    ;;
esac
```

**Why this matters**: já existe o precedente exato de abortar o boot por má configuração de
`APP_DB_PASSWORD`, com mensagem em pt-BR e instrução de como gerar o valor. O ramo `else` da L52
deve seguir a mesma forma.

**Pattern: rate limit declarativo por rota**

```typescript
// De apps/api/src/modules/auth/auth.controller.ts:52-55
@Public()
@Throttle({ default: { limit: 5, ttl: 60000 } })
@Post('register')
```

**Why this matters**: os limites já estão declarados onde importa. O problema não é o valor, é o
**tracker** — o que muda é global (`app.module.ts:33`), não por rota.

**Pattern: cabeçalhos de segurança no nginx (referência de rigor)**

```nginx
# De apps/web/nginx.conf:42-44, 65-74
# ATENÇÃO ao editar: um `add_header` dentro de um `location` DESCARTA todos os
# `add_header` herdados do `server` (o nginx substitui, não soma).
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; …" always;
```

**Why this matters**: o front já é rigoroso. Como o Traefik roteia `/api` **direto** ao container
Nest (router `crm-api`, prioridade 10 — `docker-compose.prod.yml:122,126`), as respostas da API não
passam por este nginx e saem sem cabeçalho algum. O HSTS, porém, é emitido no mesmo host pelo front,
então o navegador já o aplica ao domínio inteiro.

**Pattern: log estruturado JSON com `evento` em pt-BR**

```typescript
// De apps/api/src/main.ts:66-71
registrarLog('info', {
  evento: 'app.iniciada',
  msg: 'API pronta para receber requisições.',
  porta,
  ambiente: config.get<string>('NODE_ENV'),
});
```

**Why this matters**: `console.log` é proibido (`CLAUDE.md`). Qualquer log novo (ex.: cadastro
bloqueado por flag) usa `registrarLog` com `evento` estável.

**Pattern: documentação de deploy como prosa comentada**

O `docker-compose.prod.yml` e o `entrypoint.sh` carregam comentários longos explicando **por quê**
(prioridade dos routers do Traefik, rotação de log, idempotência). Alterações nesses arquivos devem
manter esse nível de comentário.

### Data Flow

**Requisição HTTP em produção — onde o IP se perde:**

```
Cliente (IP real)
  → Traefik  [reescreve X-Forwarded-For; conecta ao container da API pela rede docker]
    → Express (apps/api/src/main.ts)
       ├─ contextoDaRequisicao (main.ts:52)   → loga ipDoCliente() = X-Forwarded-For ✅ IP real
       ├─ cookieParser (main.ts:53)
       └─ Nest guards, na ordem de app.module.ts:62-67
          ├─ ThrottlerGuard  → getTracker(req) usa req.ip
          │                    ❌ sem `trust proxy`, req.ip = IP do container do Traefik
          │                       → balde único compartilhado por TODOS os clientes
          ├─ JwtAuthGuard    → ignora rotas @Public()
          └─ BillingGuard
             → AuthController.register (auth.controller.ts:55)
                └─ captcha.verify(token, req.ip)  ❌ mesmo IP errado vai como `remoteip` ao Turnstile
```

O log de acesso enxerga o IP certo (`ipDoCliente` lê o header na mão) enquanto o throttler e o
captcha enxergam o errado — é essa assimetria que o comentário do `request-context.middleware.ts:50`
descreve.

**Caminhos de criação de conta (dois, não um):**

```
POST /auth/register            → AuthService.register (auth.service.ts:28) → users.create
GET  /auth/oauth/<prov>/callback → AuthService.oauthLogin (auth.service.ts:46)
                                   ├─ conta vinculada?      → login
                                   ├─ e-mail já existe?     → vincula OAuth e loga
                                   └─ senão                 → users.createWithOAuth (L69) ← cadastro
```

## External Research

Pesquisa restrita ao que está instalado — versões confirmadas em `node_modules`:
`@nestjs/throttler@6.5.0`, `@nestjs/platform-express@11.1.28`, `express@5.2.1`, `joi@^18.2.3`.

### `@nestjs/throttler` v6.5.0 — superfície real do tracker

Duas vias, ambas disponíveis na versão instalada:

```typescript
// node_modules/@nestjs/throttler/dist/throttler-module-options.interface.d.ts:35
export type ThrottlerGetTrackerFunction =
  (req: Record<string, any>, context: ExecutionContext) => Promise<string> | string;

// mesma interface, L12 e L19 — aceito tanto no nível raiz do módulo
// quanto dentro de cada entrada de `throttlers`
getTracker?: ThrottlerGetTrackerFunction;

// node_modules/@nestjs/throttler/dist/throttler.guard.d.ts:20 — via herança
protected getTracker(req: Record<string, any>): Promise<string>;
```

A via de **opção** (`ThrottlerModule.forRoot({ getTracker: … })`) não exige subclasse nem trocar o
`APP_GUARD` registrado em `app.module.ts:64`.

### Express 5 — `trust proxy`

`app.set('trust proxy', <valor>)` faz o Express derivar `req.ip` do `X-Forwarded-For`. No Nest o
acesso à instância Express é `app.getHttpAdapter().getInstance().set('trust proxy', 1)`. O valor
importa: `true` confia em toda a cadeia e permite que o cliente **forje** o primeiro IP do header;
`1` confia apenas no salto mais próximo (o Traefik), que é a topologia real descrita em
`docs/deploy.md:9-19`. Como o Traefik **reescreve** o `X-Forwarded-For` (não apenas concatena), o
último elemento é o mais confiável.

### `helmet`

Não é dependência hoje. Instalação: `pnpm --filter api add helmet`; uso `app.use(helmet())` em
`main.ts`. Numa API que só devolve JSON, o CSP default do helmet é inofensivo, mas o front já entrega
o seu próprio CSP pelo nginx — os dois convivem porque atendem caminhos diferentes (`/` vs `/api`).

### Arquivos de comunidade do GitHub

- `SECURITY.md` (raiz ou `.github/`) é renderizado na aba **Security** e é o canal esperado de
  reporte. Complementa — não substitui — o **private vulnerability reporting**, que é uma opção do
  repositório (Settings → Code security), não um arquivo versionado.
- `CODE_OF_CONDUCT.md`: o padrão de fato é o Contributor Covenant 2.1, que existe em tradução pt-BR
  oficial. Exige um e-mail de contato para reportes.
- `.github/ISSUE_TEMPLATE/*.yml` (formulários) e `.github/PULL_REQUEST_TEMPLATE.md`.
- `.github/dependabot.yml`: para este repo os ecossistemas relevantes são três — `npm` (com
  `directory: "/"`, já que é workspace pnpm com lockfile único na raiz), `docker` (as imagens base
  `node:22-alpine`, `nginx:alpine`, `postgres:16-alpine`) e `github-actions` (as actions pinadas em
  `build.yml`/`deploy.yml`).
- Metadados de licença nos `package.json`: identificador SPDX `"Apache-2.0"`.

## Historical Context

- **`specs/plans/2026-07-24-preparar-open-source.md`** (status: `implemented`) — a spec que trouxe
  `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, README público, Dockerfiles e `docker-compose.prod.yml`.
  Decisões de produto que continuam valendo e **restringem** o que esta rodada pode fazer:
  - sem license key, DRM ou phone-home; autohospedagem irrestrita e gratuita;
  - sem reescrita de histórico git (auditoria confirmou desnecessário — reconfirmado hoje);
  - marca ("ProgrameAi", teal `#0E7C7B`) é a única proteção retida, via seção de Trademark no README;
  - a spec **declarou explicitamente fora de escopo** renomear os pacotes internos (`name: "api"`,
    `name: "web"`) — mas não tratou do campo `license` deles, que é a lacuna atual;
  - a seção "Environment Considerations" daquela spec já pedia rotacionar secrets de dev em uso real.
- **`specs/plans/2026-07-24-billing-stripe.md`** — origem do `BILLING_ENABLED` e do `BillingGuard`
  (`app.module.ts:66`). Relevante porque o gate de assinatura e um eventual gate de cadastro operam
  na mesma região do fluxo de autenticação.
- **`specs/plans/2026-07-23-rls-por-ownerid.md`** — origem da role `crm_app` e das políticas RLS. A
  senha de dev na migration é consequência direta daquela decisão ("roles são objetos de cluster",
  `migration.sql:2-5`).
- **Commits recentes relevantes** (`git log`): `12c1104` e `fe45ec6` ajustaram o `build.yml`
  (escolha de imagem no dispatch, rebuild seletivo por app) — o `paths-ignore` é recente e
  deliberado. `bca3a89`/`2e65cba` adicionaram Termos de Uso e Política de Privacidade ao fluxo de
  login, o que indica que a instância de produção já opera com usuários reais.

## Constraints & Considerations

- **Produção está no ar.** Mudar o tracker do throttler altera o comportamento de rate limit de
  `/auth/*` para usuários reais. É uma mudança de runtime: exige novo deploy (não é `VITE_*`, que
  precisaria de rebuild — ver `docs/deploy.md:141-145`).
- **`trust proxy` é uma decisão já documentada.** O comentário em
  `request-context.middleware.ts:49-51` e o teste `request-context.middleware.spec.ts:118`
  ("prefere o IP do x-forwarded-for ao IP do proxy") assumem o estado atual. Mudar a configuração
  torna `ipDoCliente()` parcialmente redundante — decidir se ele é simplificado ou mantido, e
  atualizar comentário e teste na mesma passada.
- **Duas portas de cadastro.** Qualquer gate precisa cobrir `POST /auth/register` **e** o ramo de
  criação em `AuthService.oauthLogin` (`auth.service.ts:69`), senão o OAuth vira bypass.
- **Compatibilidade com autohospedagem.** Uma flag tipo `REGISTRATION_ENABLED` precisa de default
  que não quebre quem sobe o projeto do zero: com cadastro fechado por padrão, a primeira conta
  ficaria impossível de criar (não há seed de admin em produção — `docs/deploy.md:159-160`).
- **`docs/deploy.md` também é copiado para a VPS?** Não — o `deploy.yml` copia apenas
  `docker-compose.prod.yml` (`scp-action`, `source: "docker-compose.prod.yml"`). Mudanças em docs não
  exigem deploy.
- **A senha de dev da role fica pública.** Instâncias existentes que subiram sem `APP_DB_PASSWORD`
  continuam com `'crm_app_password'` no banco. O hard-fail protege boots futuros, não os passados —
  a mudança precisa vir com nota de operação para verificar a VPS antes do deploy.
- **`helmet` é dependência nova.** Toca `apps/api/package.json` e o `pnpm-lock.yaml`, e o
  `build.yml` **vai** disparar (não está em `paths-ignore`). Os Dockerfiles usam
  `pnpm install --frozen-lockfile`: o lockfile precisa ser commitado junto ou o build quebra.
- **Docs são o produto público.** `docs/deploy.md` e `docs/observabilidade.md` são hoje runbooks
  internos escritos para uma VPS específica. Genericizá-los sem torná-los inúteis para o próprio
  mantenedor é um trade-off de redação, não técnico — uma opção é separar o que é receita
  reproduzível (público) do que é o estado da VPS (privado ou variabilizado).
- **`paths-ignore` do build.yml** já cobre `.md`, `docs/`, `specs/`, `.github/` e `.env.example`:
  as frentes 1 e 3 não gastam minutos de Actions. A frente 2 (código + lockfile) gasta.
- **Permalinks do GitHub não se aplicam** nesta rodada: o repositório ainda é privado
  (`visibility: PRIVATE`). As referências abaixo são locais.
- **Divergência de remote**: `git remote -v` aponta para `Edsonalencar/CRM`, mas `gh repo view`
  resolve `programeai/CRM`. Provável transferência de propriedade com redirect ativo — confirmar
  qual é o slug canônico antes de escrever URLs em `SECURITY.md`, README ou templates.

## Open Questions

1. **Qual o comportamento desejado do cadastro em produção?** Fechar por completo depois da conta do
   owner, manter aberto com captcha obrigatório, ou uma allowlist de domínio de e-mail? A resposta
   define se a flag é booleana, uma lista, ou se o gate é "só permite cadastro se ainda não houver
   nenhum usuário".
2. **`TURNSTILE_SECRET_KEY` está preenchida na produção hoje?** Não é verificável do repositório
   (`captcha.service.ts:20` desliga silenciosamente quando vazia). Determina a urgência do item 1.
3. **`APP_DB_PASSWORD` está setada na VPS?** Se não estiver, a role `crm_app` está com a senha que
   vai virar pública — nesse caso a correção não é só o hard-fail, é um `ALTER ROLE` imediato.
4. **Até onde genericizar `docs/deploy.md`?** Remover só a menção ao "Dorado da Sorte", ou reescrever
   o documento inteiro em termos de placeholders (`<seu-dominio>`, `<dir-de-deploy>`) e mover as
   particularidades da VPS para um doc fora do repositório?
5. **E-mail de contato para `SECURITY.md` e o código de conduta.** `security@programeai.com.br`,
   o e-mail pessoal do mantenedor, ou habilitar o private vulnerability reporting do GitHub e apontar
   só para ele?
6. **`APRESENTACAO-PRODUTO.md` deve continuar versionado?** É material interno endereçado à "equipe
   de Marketing" (L3). Não vaza nada sensível, mas é uma escolha editorial sobre o que o repo público
   comunica.
7. **Escopo do `trust proxy`:** valor `1` (confia só no Traefik) é o correto para a topologia atual,
   mas a autohospedagem genérica pode ter zero ou N proxies. Vira variável de ambiente ou fica fixo?

## Code References Index

- `.env.example:54` — comentário corrompido (`Trae/api/v1fik`), não commitado
- `.env.example:33-42` — bloco do banco, onde `APP_DB_PASSWORD` é documentada
- `package.json:2-3` — raiz, `"name": "crm"`, `"private": true`, sem `license`
- `apps/api/package.json:7` — `"license": "UNLICENSED"`
- `apps/web/package.json:1-6` — sem campo `license`
- `apps/api/src/main.ts:50-63` — bootstrap: middleware, cookieParser, ValidationPipe, `enableCors`
- `apps/api/src/main.ts:66-71` — padrão de log estruturado (`registrarLog`)
- `apps/api/src/app.module.ts:33` — `ThrottlerModule.forRoot`, onde `getTracker` entraria
- `apps/api/src/app.module.ts:62-67` — ordem dos guards globais
- `apps/api/src/config/env.validation.ts:9-11,27` — padrão Joi obrigatório vs. opcional
- `apps/api/src/shared/logging/request-context.middleware.ts:44-56` — `ipDoCliente()` e a decisão
  documentada de não usar `trust proxy`
- `apps/api/src/shared/logging/request-context.middleware.spec.ts:118` — teste que fixa esse contrato
- `apps/api/src/modules/auth/auth.controller.ts:52-67` — `register`: `@Public`, throttle, captcha
- `apps/api/src/modules/auth/auth.controller.ts:70-99` — `login`, `forgot-password`, `reset-password`
- `apps/api/src/modules/auth/auth.service.ts:28-39` — `register()`
- `apps/api/src/modules/auth/auth.service.ts:46-75` — `oauthLogin()`; L69 cria conta nova
- `apps/api/src/modules/auth/captcha/captcha.service.ts:20-22` — captcha desliga sem secret
- `apps/api/docker/entrypoint.sh:40-47` — padrão de fail-fast com mensagem acionável
- `apps/api/docker/entrypoint.sh:51-53` — ramo `else` que só avisa sobre `APP_DB_PASSWORD`
- `apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql:10` — senha de dev da role
- `apps/web/nginx.conf:42-44,65-74` — cabeçalhos de segurança do front
- `docker-compose.prod.yml:74-79` — montagem de `DATABASE_URL`/`APP_DATABASE_URL`
- `docker-compose.prod.yml:122,126` — router `crm-api` e prioridade `/api`
- `docker-compose.yml:11` — Postgres de dev na porta `5435`
- `docs/deploy.md:3,33` — menções ao "Dorado da Sorte"
- `docs/deploy.md:31-38` — pré-requisitos com caminhos do host
- `docs/deploy.md:157-164` — primeiro acesso e o aviso sobre `/auth/register` público
- `docs/observabilidade.md:5,137` — host do Grafana e do CRM nos exemplos
- `.github/workflows/build.yml:22-35` — `paths-ignore`
- `.github/workflows/deploy.yml:56-80` — passos SSH com os quatro secrets de VPS
- `specs/plans/2026-07-24-preparar-open-source.md` — spec anterior, implementada
- `CLAUDE.md` (seção "Ferramentas do monorepo") — porta `5432` divergente do compose
