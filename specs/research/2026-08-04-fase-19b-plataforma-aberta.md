---
date: 2026-08-04T09:47:57-03:00
researcher: claude
git_commit: c5ff58272b04491f985ae2937f7dcc643e00db7c
branch: main
topic: "Fase 19-B — Plataforma aberta: API pública por owner, webhooks de saída, 2FA/TOTP, LGPD completo"
tags: [research, integracoes, notifications, auth, account, lgpd, plataforma]
status: complete
---

# Research: Fase 19-B — Plataforma aberta

## Research Question

Documentar o contexto para implementar a Fase 19-B ([ROADMAP.md:315-347](../../ROADMAP.md)):

- API key por owner, com escopos e rotação (API pública para sistema externo escrever no CRM)
- Webhooks de saída (eventos de negócio) para n8n/Zapier
- 2FA/MFA no login (TOTP), com códigos de recuperação
- LGPD completo: consentimento e política de retenção
- Rastreio de consentimento de comunicação (opt-out de e-mail/WhatsApp)

## Summary

**A 19-B não é uma fase — são cinco frentes de naturezas diferentes que o roadmap agrupou por serem todas "plataforma e governança" (P3).** Duas delas herdam infraestrutura pronta e são majoritariamente aditivas (API pública, webhook de saída). Três são campo verde sem nenhuma linha de código no repo (2FA, consentimento, retenção). Tratar as cinco como um plano só produz uma spec que ninguém consegue executar; a recomendação de recorte está nas Questões Abertas.

**O que o ROADMAP promete está correto, e é melhor do que ele diz.** A máquina de segredo-por-registro da 17-A ([`modules/integracoes/`](../../apps/api/src/modules/integracoes/)) não é apenas genérica de intenção — o método de autenticação **já recebe o escopo exigido como parâmetro** (`autenticar(valor, escopoExigido)`, [integration-keys.service.ts:163](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts)), recusa chave inexistente e revogada com mensagem idêntica, separa 403 de escopo insuficiente do 401 de credencial inválida, e o repositório mantém `keyHash` fora de todo `select`. Acrescentar um escopo é literalmente acrescentar um objeto ao array de [integration-scope.ts:10-17](../../apps/api/src/modules/integracoes/domain/integration-scope.ts). **Porém:** não existe `POST /integracoes/chaves` — a 17-A decidiu que "chave nasce junto do registro que ela credencia", e uma API key de owner sem canal de captação exige rever essa decisão. É a primeira bifurcação da fase.

**O caminho de escrita externa sob RLS já foi resolvido, e tem uma restrição que colide com webhook de saída.** `POST /leads/intake` é hoje a única rota pública que escreve em tabela com RLS, e paga por isso com [`PrismaService.executarComoOwner`](../../apps/api/src/prisma/prisma.service.ts) — abre transação e faz `set_config('app.owner_id', …, true)` como primeira statement. O docblock impõe duas obrigações: o `ownerId` vem de onde a rota autenticou (nunca do corpo) e **nada de I/O de rede dentro da transação** (timeout de 5s do Prisma). Webhook de saída é I/O de rede por definição, então ele obrigatoriamente sai pelo padrão outbox — que também já existe, em `NotificationDelivery` + cron de 1 minuto + backoff `[1, 5, 30, 120, 480]` minutos.

**Não existe event bus no projeto.** Grep por `EventEmitter2`/`@OnEvent`/`emitAsync` em `apps/` retorna zero. Notificação hoje é chamada direta de service dentro da transação do request, com fan-out por linha de outbox. São 8 tipos de evento de negócio (`NotificationType`) emitidos de 12 pontos de código — esse é o catálogo candidato para o webhook de saída, e a Fase 16 é que reservou o motor de regras/event bus.

**O HMAC já está especificado palavra por palavra**, na decisão D4 do research da Fase 9: `HMAC-SHA256` sobre `<timestamp>.<body>` com o corpo cru exatamente como enviado, em `X-CRM-Signature: sha256=<hex>`. Isso coincide com o esquema do Stripe (`t.body` → hex) e é uma variante do Standard Webhooks (`id.timestamp.body` → base64). Os dois insumos já viajam nos headers: `X-CRM-Delivery` e `X-CRM-Timestamp`.

**Em LGPD, o que a 19-A entregou é sólido e o que falta é campo verde — com uma exposição já existente.** Não há uma linha de consentimento, opt-out, `unsubscribe` ou retenção configurável no repo. Duas tensões que a 19-B herda: (a) a [`PrivacidadePage.tsx`](../../apps/web/src/features/legal/PrivacidadePage.tsx) **já promete ao titular** banner de consentimento de cookies e revogação de consentimento que não existem em código; (b) a 19-A fixou o precedente de que prazo de retenção **não é decisão de instância** (30 e 180 dias como constantes exportadas, sem variável de ambiente), o que contradiz frontalmente "política de retenção configurável".

**Correção importante de rastreamento:** a issue [#26](https://github.com/programeai/CRM/issues/26) **não é guarda-chuva da 19-B** — ela é a sobra da Fase 9 ("Assinar o canal WEBHOOK de notificações com HMAC-SHA256"). O ROADMAP a linka nas linhas da Fase 9 e da Fase 19, o que produz a confusão. Não existe issue para API pública, webhook de saída do owner, 2FA ou consentimento.

---

## Codebase Map

### Frente 1 — API pública por owner (chave com escopos)

| Arquivo | Papel | Relevância |
|---|---|---|
| [`integracoes/domain/integration-scope.ts:10-17`](../../apps/api/src/modules/integracoes/domain/integration-scope.ts) | Catálogo de escopos | **Um único item** (`lead:receber`). Escopo novo entra aqui. Consumidores de `INTEGRATION_SCOPES`: só o controller e o próprio arquivo |
| [`integracoes/application/integration-keys.service.ts`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts) | A máquina inteira | `emitir` L74 · `rotacionar` L110 · `revogar` L133 · `apagar` L152 · **`autenticar` L163** · `registrarUso` L191 · `gerar` L206 · `hash` L211 · `paraApi` L216 |
| [`integracoes/api/integracoes.controller.ts`](../../apps/api/src/modules/integracoes/api/integracoes.controller.ts) | Fronteira HTTP | 4 rotas: `GET escopos` L25, `GET chaves` L31, `POST chaves/:id/rotacionar` L38, `DELETE chaves/:id` L48. **Não há POST de criação avulsa** (L14-19 documenta o porquê) |
| [`integracoes/infra/prisma-integration-key.repository.ts`](../../apps/api/src/modules/integracoes/infra/prisma-integration-key.repository.ts) | Persistência | `CAMPOS` L10-19 deixa `keyHash` fora de todo `select`; `findByHashPeloSistema` L89-94 usa `PrismaAdminService` (autenticação roda antes de existir `app.owner_id`) |
| [`schema.prisma:138-159`](../../apps/api/prisma/schema.prisma) | `IntegrationKey` | `keyHash @unique`, `prefix`, `scopes String[]`, `lastUsedAt`, `revokedAt`. FK `onDelete: Cascade` para `User` |
| [`migrations/20260811100000_integration_key/migration.sql`](../../apps/api/prisma/migrations/20260811100000_integration_key/migration.sql) | RLS + índices | `ENABLE`+`FORCE ROW LEVEL SECURITY`, policy `owner_isolation`, `IntegrationKey_keyHash_key` |
| [`prisma/fixtures/invariantes.sql:284-298`](../../apps/api/prisma/fixtures/invariantes.sql) | Portão | Falha se RLS estiver desligado em `IntegrationKey`/`LeadIntakeChannel` |
| [`shared/audit-diff.ts:10-32`](../../apps/api/src/shared/audit-diff.ts) | `CAMPOS_OMITIDOS` | `keyHash` L13 e `prefix` L14 já omitidos do diff da auditoria |
| [`shared/permissions.ts:196-201`](../../apps/api/src/shared/permissions.ts) | Permissão | `integracao:gerenciar`, categoria Organização. Catálogo tem 26 chaves |

**O padrão de rota pública que escreve sob RLS** — o molde exato a reusar:

| Arquivo | Papel |
|---|---|
| [`leads/api/leads-intake.controller.ts:26-32`](../../apps/api/src/modules/leads/api/leads-intake.controller.ts) | `@Public()` + `@UseGuards(LeadIntakeKeyGuard)` + `@Throttle({ limit: 30, ttl: 60000 })` + `@HttpCode(200)` |
| [`leads/api/lead-intake-key.guard.ts:39-68`](../../apps/api/src/modules/leads/api/lead-intake-key.guard.ts) | Extrai `Authorization: Bearer`, chama `keys.autenticar(valor, ESCOPO_RECEBER_LEAD)`, publica `req[INTAKE_CONTEXT] = { ownerId, keyId }` |
| [`leads/api/intake-context.ts:27-37`](../../apps/api/src/modules/leads/api/intake-context.ts) | Param decorator que lança 401 se o contexto faltar (fail-closed se a rota perder o guard) |
| [`prisma/prisma.service.ts:75-94`](../../apps/api/src/prisma/prisma.service.ts) | **`executarComoOwner`** — transação + `set_config` + CLS, com restauração no `finally` |
| [`leads/application/leads-intake.service.ts:75-102`](../../apps/api/src/modules/leads/application/leads-intake.service.ts) | Chama `executarComoOwner`; a notificação sai **depois do commit**, por `notificarPeloSistema` |
| [`test/lead-intake.e2e-spec.ts`](../../apps/api/test/lead-intake.e2e-spec.ts) | 462 linhas, banco real. Afirma que a linha está no banco depois da chamada — sem contexto o RLS grava zero linha e a rota responde sucesso |

**Superfície pública atual:** 14 rotas `@Public()` em 5 controllers. `auth` (9), `collaborators/invites` (2), `billing/webhook` (1), `health` (1), `leads/intake` (1). Só a última escreve em tabela com RLS.

### Frente 2 — Webhook de saída do owner

| Arquivo | Papel | Relevância |
|---|---|---|
| [`notifications/infra/webhook.channel.ts:89-108`](../../apps/api/src/modules/notifications/infra/webhook.channel.ts) | Transporte | `fetch` nativo, timeout 10s, headers `X-CRM-Delivery`/`X-CRM-Timestamp`/`User-Agent`. **`JSON.stringify(corpo)` acontece dentro da chamada do `fetch`** — assinar exige extrair para variável antes |
| [`notifications/application/webhook-url.ts:17-43`](../../apps/api/src/modules/notifications/application/webhook-url.ts) | Anti-SSRF | HTTPS obrigatório, porta só 443, resolve **todos** os IPs do host e recusa loopback/link-local/privado/CGNAT/multicast. Defesa contra DNS rebinding. **Reusável direto** |
| [`notifications/application/notifications-dispatcher.service.ts:14,41,56-115`](../../apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts) | Retry | `BACKOFF_MIN = [1, 5, 30, 120, 480]` → 6 tentativas, esgota em ~10,6h. `Promise.allSettled`. `lastError` truncado em 500 |
| [`notifications/application/notifications-dispatch.job.ts:31`](../../apps/api/src/modules/notifications/application/notifications-dispatch.job.ts) | Cron | `* * * * *`, lote de 200. Existe porque **não há hook de post-commit** |
| [`schema.prisma:1010-1038`](../../apps/api/prisma/schema.prisma) | `NotificationDelivery` | A linha do outbox: `status`, `attempts`, `nextAttemptAt`, `lastError`, `sentAt`. Índice `[status, nextAttemptAt]` |
| [`schema.prisma:1040-1067`](../../apps/api/prisma/schema.prisma) | `UserNotificationTarget` | Destino **do usuário**. `types[]` é a preferência (opt-in por destino). `config` documentado como portador de segredo |
| [`billing/api/stripe-webhook.controller.ts:31`](../../apps/api/src/modules/billing/api/stripe-webhook.controller.ts) | Precedente | Único ponto do repo que **verifica** assinatura de webhook (`STRIPE_WEBHOOK_SECRET` sobre `rawBody`). Molde para o lado emissor |

**Catálogo de eventos de negócio hoje** — 8 tipos, 12 pontos de emissão:

| Tipo | Ponto de emissão |
|---|---|
| `RECORD_ASSIGNED` | `clients.service.ts:95,186` · `deals.service.ts:131,177` · `tasks.service.ts:101,137` · `activities.service.ts:52,131` (guard comum: `shared/assignee-changed.ts`) |
| `PAYMENT_OVERDUE` | `finance-billing.job.ts:71` (cron 3h) |
| `PROPOSAL_EXPIRING` | `proposals-expiration.job.ts:51` (cron 3h) e `notifications-reminders.job.ts:161` |
| `LEAD_RECEIVED` | `leads-intake.service.ts:91` |
| `FOLLOW_UP_DUE`, `PAYMENT_DUE`, `TASK_OVERDUE`, `DEAL_STALE` | `notifications-reminders.job.ts:161` (cron 6h BRT) |

**Risco não documentado:** não há lock distribuído em nenhum dos 8 crons, e `findPendentes` é um `findMany` simples (sem `FOR UPDATE SKIP LOCKED`). Roda seguro hoje porque o deploy é instância única por construção — [`docker-compose.prod.yml`](../../docker-compose.prod.yml) declara `container_name: crm-api` sem `deploy.replicas`, e `container_name` fixo impede scale-out. Se a 19-B reusar a máquina de entrega e o deploy escalar, dois processos pegam o mesmo lote e entregam duas vezes.

### Frente 3 — 2FA/TOTP

Zero código. Grep por `totp|2fa|mfa|two-factor|authenticator|recovery code` em `apps/`, `docs/` e `schema.prisma`: **nenhuma ocorrência**.

| Arquivo | Papel | Relevância |
|---|---|---|
| [`auth/auth.service.ts:434-471`](../../apps/api/src/modules/auth/auth.service.ts) | **`issueTokens`** | Ponto de estrangulamento único: `sid = randomUUID()`, dois JWTs com payload `{ sub, sid }`, `sessions.create` com `tokenHash: argon2(refresh)`, `accessRecords.registrar({ kind: 'LOGIN' })` |
| [`auth/auth.service.ts:104-117`](../../apps/api/src/modules/auth/auth.service.ts) | Login | `argon2.verify` L107-113 → `assertActive` L116 → `issueTokens` L117. **Nada entre a validação e a emissão** |
| — | Os 7 chamadores de `issueTokens` | login L117 · register L54 · OAuth L73, L90, L100 · convite L367-369 · refresh assina par novo sem passar por `issueTokens` (L283-298) |
| [`auth/auth.service.ts:160-240`](../../apps/api/src/modules/auth/auth.service.ts) | Token de uso único | `randomBytes(32).toString('hex')` + `sha256` + `expiresAt` + `usedAt`; TTL 1h; consumo *check-then-act*; `sessions.revokeAll` no fim |
| [`collaborators/infra/prisma-invite.repository.ts:67-78`](../../apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts) | Variante melhor | Consumo *compare-and-swap*: `updateMany where { id, usedAt: null }`. **É o padrão certo para código de recuperação** (dois usos simultâneos) |
| [`schema.prisma:217-230`](../../apps/api/prisma/schema.prisma) | `PasswordResetToken` | sha256 (não argon2) porque 32 bytes de entropia bastam e permite busca indexada. Fora do RLS |
| [`schema.prisma:232-269`](../../apps/api/prisma/schema.prisma) | `Session` | **Fora do RLS de propósito** — nasce em rota `@Public()` sem `app.owner_id`; policy fecharia a escrita |
| [`schema.prisma:15-86`](../../apps/api/prisma/schema.prisma) | `User` | Hoje só `passwordHash`/`passwordSetAt` sobre estado de autenticação. `passwordSetAt` — nunca `passwordHash IS NOT NULL` — é quem responde "esta pessoa sabe uma senha?" |
| [`account/application/account-deletion.service.ts:126-145`](../../apps/api/src/modules/account/application/account-deletion.service.ts) | Reautenticação | Precedente OWASP ASVS 3.7.1. Lança `ForbiddenException`, **nunca 401**, porque 401 em rota autenticada dispara o refresh/logout do cliente HTTP |
| [`web/src/lib/api.ts:23-63`](../../apps/web/src/lib/api.ts) | Cliente HTTP | Fila single-flight de refresh. 402 → `/assinatura`. Falha do refresh → `/login` |
| [`web/src/features/perfil/SessoesAtivas.tsx`](../../apps/web/src/features/perfil/SessoesAtivas.tsx) | Onde o 2FA encaixa | Aba "Dispositivos" em `/configuracoes`. Não existe tela de segurança nem troca de senha logada |

`AccessRecordKind` ([`schema.prisma:883-889`](../../apps/api/prisma/schema.prisma)) só conhece `LOGIN | LOGIN_OAUTH | ACEITE_DE_CONVITE | LOGOUT`, e registra **exclusivamente eventos bem-sucedidos** — tentativa falha de 2FA não tem onde ser registrada hoje.

### Frentes 4 e 5 — LGPD completo, consentimento e opt-out

Zero código de consentimento. Grep por `consent|consentiment|optOut|opt_out|retention|retencao|unsubscribe|descadastr` em código de aplicação: **nenhuma ocorrência**.

| Arquivo | Papel | Relevância |
|---|---|---|
| [`account/application/account-export.service.ts:37-116`](../../apps/api/src/modules/account/application/account-export.service.ts) | 19-A entregue | Dump JSON síncrono, `StreamableFile`. Sem teto de linhas de propósito |
| [`account/application/account-deletion.service.ts:39-107`](../../apps/api/src/modules/account/application/account-deletion.service.ts) | 19-A entregue | Agendamento com carência de 30 dias, cancelável. Reautenticação por senha ou e-mail |
| [`account/application/account-purge.job.ts:35`](../../apps/api/src/modules/account/application/account-purge.job.ts) | **O molde de retenção** | Cron 5h, `PrismaAdminService`, transação de 120s. Cascata em ordem topológica de 12 tabelas |
| [`account/api/account.controller.ts:32-63`](../../apps/api/src/modules/account/api/account.controller.ts) | Portão novo | `@OwnerOnly()` + `@AllowWithoutSubscription()` — "o único portão do CRM que não é delegável" |
| [`schema.prisma:287-330`](../../apps/api/prisma/schema.prisma) | `Client` | Âncoras do opt-out: `email` L294, `phone` L295. **Não existe modelo `Lead`** — lead é `Client` com `status: LEAD` |
| [`schema.prisma:332-347`](../../apps/api/prisma/schema.prisma) | `Contact` | `email` L339, `phone` L340 |
| [`mail/mail.service.ts`](../../apps/api/src/mail/mail.service.ts) | Saída SMTP | **Todo destinatário é `User`** (owner, colaborador ou convidado). Nunca há envio para `Client`/`Contact` |
| [`schema.prisma:716-738`](../../apps/api/prisma/schema.prisma) | `AuditLog` | Sem retenção. `REVOKE UPDATE, DELETE … FROM crm_app` — a aplicação **não consegue** apagar a trilha; só `PrismaAdminService` alcança |
| [`web/src/features/legal/PrivacidadePage.tsx:207,383,386`](../../apps/web/src/features/legal/PrivacidadePage.tsx) | **Exposição existente** | Promete banner de consentimento de cookies e revogação de consentimento que não existem em código |

**Retenção que existe hoje** — toda hard-coded, nenhuma configurável:

| Constante | Valor | Arquivo | Cron |
|---|---|---|---|
| `RETENCAO_SESSAO_VENCIDA_DIAS` | 30 | [`auth/sessions-cleanup.job.ts:10`](../../apps/api/src/modules/auth/sessions-cleanup.job.ts) | 3h |
| `RETENCAO_REGISTRO_DE_ACESSO_DIAS` | 180 | [`auth/access-records.service.ts:10`](../../apps/api/src/modules/auth/access-records.service.ts) | 4h |
| `CARENCIA_DE_ENCERRAMENTO_DIAS` | 30 | [`account/domain/account-deletion.ts`](../../apps/api/src/modules/account/domain/account-deletion.ts) | 5h |
| `RETENCAO_DIAS` (backup) | 30 | [`scripts/backup-postgres.sh`](../../scripts/backup-postgres.sh) | host |

**Sem retenção nenhuma:** `AuditLog`, `Notification`/`NotificationDelivery` e a lixeira. Soft delete é `archivedAt` (não `deletedAt`), em 5 tabelas (`Client`, `Contact`, `Deal`, `Project`, `Task`); expurgo é manual por registro, e a doutrina "nenhuma cascata" vive em [`shared/purge.ts:17-30`](../../apps/api/src/shared/purge.ts).

### Front-end — onde tudo encaixa

| Arquivo | Papel |
|---|---|
| [`web/src/features/integracoes/CaptacaoPage.tsx`](../../apps/web/src/features/integracoes/CaptacaoPage.tsx) | A tela de chaves — na verdade a aba **Captação**; a chave vive dentro da linha do canal. Dialog de exibição única L237-267 |
| [`web/src/components/ui/copy-box.tsx`](../../apps/web/src/components/ui/copy-box.tsx) | Primitivo de segredo de exibição única (existe pelos "dois segredos do produto": link de convite e chave) |
| [`web/src/features/administracao/tabs.ts:16-57`](../../apps/web/src/features/administracao/tabs.ts) | `ADMIN_TABS` — fonte única da navegação de administração; `ADMIN_PERMISSIONS` derivado |
| [`web/src/features/configuracoes/ConfiguracoesLayout.tsx:12-25`](../../apps/web/src/features/configuracoes/ConfiguracoesLayout.tsx) | Abas da conta. `TAB_DA_CONTA` só se `isOwner` — o primeiro gate por `isOwner` da interface |
| [`web/src/hooks/use-can.ts:13-32`](../../apps/web/src/hooks/use-can.ts) | `useCan()` — a única porta de permissão na UI |
| [`web/src/lib/labels.ts:14-17`](../../apps/web/src/lib/labels.ts) | A fábrica `make()` de tradução de enum. 17 enums cobertos |
| [`web/src/lib/api-error.ts:7-14`](../../apps/web/src/lib/api-error.ts) | `extractApiMessage` — mensagem já vem em pt-BR do backend |
| [`web/src/components/ui/confirm-typed-dialog.tsx`](../../apps/web/src/components/ui/confirm-typed-dialog.tsx) | Confirmação por segredo (`expected` + `secret`) — molde para desativar 2FA |

Nota: **o front não consome `GET /integracoes/chaves` nem `GET /integracoes/escopos` hoje** — o único endpoint de `/integracoes/` usado é `rotacionar`. Uma tela de API key vai estrear os dois.

### Existing Patterns to Follow

**Padrão: geração e hash de credencial de máquina** — [`integration-keys.service.ts:206-213`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts)

```ts
private gerar(): string {
  return `${PREFIXO}${randomBytes(32).toString('hex')}`;   // crm_ + 64 hex
}
// Determinístico: permite busca indexada pelo valor apresentado.
private hash(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}
```

**Por que importa:** sha256 determinístico e não argon2 porque a chave chega **sozinha** no header, sem identificador ao lado — a autenticação tem de ser um `findUnique` indexado, e não N `argon2.verify`. Consequência aceita e documentada: sem `timingSafeEqual`, porque não existe segredo local com que comparar byte a byte.

**Padrão: autenticação por escopo, já genérica** — [`integration-keys.service.ts:163-188`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts)

```ts
async autenticar(valor: string, escopoExigido: IntegrationScope) {
  const chave = await this.repo.findByHashPeloSistema(this.hash(valor));
  if (!chave || chave.revokedAt) {
    // Mesma mensagem para inexistente e revogada: não vaza qual é o caso.
    throw new UnauthorizedException('Chave de integração inválida.');
  }
  if (!chave.scopes.includes(escopoExigido)) {
    throw new ForbiddenException('Esta chave de integração não tem permissão para esta operação.');
  }
  return { ownerId: chave.ownerId, keyId: chave.id };
}
```

**Por que importa:** é o contrato que qualquer rota da API pública vai chamar. Não precisa de mudança nenhuma para escopos novos.

**Padrão: escrita externa sob RLS** — [`prisma.service.ts:75-94`](../../apps/api/src/prisma/prisma.service.ts)

```ts
async executarComoOwner<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
  const anterior = this.cls.get<PrismaTx>(PRISMA_TX);
  try {
    return await this.base.$transaction(async (tx) => {
      // set_config seguro: valor via bound param (nunca concatenar/interpolar).
      await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, true)`;
      this.cls.set(PRISMA_TX, tx);
      return fn();
    });
  } finally {
    this.cls.set(PRISMA_TX, anterior);
  }
}
```

**Por que importa:** duas obrigações no docblock. O `ownerId` vem de onde a rota autenticou, nunca do corpo. E **nada de I/O de rede dentro** — timeout de 5s. Sem contexto o RLS não estoura: grava zero linha e a rota responde sucesso, e é por isso que o e2e tem de afirmar a linha no banco.

**Padrão: outbox com backoff** — [`notifications-dispatcher.service.ts:91-115`](../../apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts)

```ts
const BACKOFF_MIN = [1, 5, 30, 120, 480];   // 6 tentativas, esgota em ~10,6h
const espera = BACKOFF_MIN[attempts - 1];
// espera == null → nextAttemptAt: null → FAILED definitivo
// senão → status volta a PENDING e o cron de 1 min pega de novo
```

**Padrão: log estruturado com `evento` estável** — regra em [`apps/api/CLAUDE.md:64-79`](../../apps/api/CLAUDE.md)

Nomes já em uso no caminho de credencial: `integracao.chave_emitida`, `integracao.chave_rotacionada`, `integracao.chave_revogada`, `integracao.chave_recusada`, `integracao.escopo_insuficiente`, `lead.token_recusado`, `lead.token_legado_aceito`. Formato `substantivo.acao_no_passado`, em pt-BR. Renomear um evento existente quebra a contagem histórica no Grafana. `CHAVE_SENSIVEL` ([`shared/logging/log.ts:28`](../../apps/api/src/shared/logging/log.ts)) **não** cobre `chave` nem `url`, e `msg` não é redigida.

### Data Flow

**Hoje — lead entrando (o sentido que a 17-A resolveu):**

```
POST /api/v1/leads/intake
  ThrottlerGuard (30/min por IP)
  JwtAuthGuard  → @Public() → passa sem req.user
  AccessGuard   → @Public() → passa sem req.access
  BillingGuard  → @Public() → passa
  LeadIntakeKeyGuard
      Authorization: Bearer crm_…
      TokenLegadoService.confere()  ← caminho legado, sha256 + timingSafeEqual
      IntegrationKeysService.autenticar(valor, 'lead:receber')
          findByHashPeloSistema(sha256)  ← PrismaAdminService, antes de app.owner_id
      req[INTAKE_CONTEXT] = { ownerId, keyId }
  OwnerContextInterceptor → ownerId undefined → NÃO abre transação
  LeadsIntakeService.gravar
      prisma.executarComoOwner(ownerId, …)   ← set_config('app.owner_id')
          canais.findByKeyId → assigneeId, sourceId
          clients.findByPhoneDigits → dedupe por telefone
          upsert do Client + Contact
          keys.registrarUso  ← dentro da transação: rollback não marca uso
      ── COMMIT ──
      notificarPeloSistema(LEAD_RECEIVED)   ← fora da transação, pós-commit
```

**Hoje — notificação saindo (a máquina que o webhook de saída herda):**

```
Service de negócio (dentro da transação do request)
  NotificationsService.notificar()
      findElegiveis(ownerId, userId, tipo)   ← filtra active + verified + types[]
      create aninhado: 1 Notification + N NotificationDelivery (PENDING)
  ── COMMIT ──                    (nenhum I/O de rede até aqui)

NotificationsDispatchJob  (cron * * * * *)
  findPendentes(now, 200)          ← findMany simples, SEM lock
  NotificationsDispatcherService.despacharLote()  ← Promise.allSettled
      Map<kind, canal>.get(kind)   ← if/switch por canal proibido fora daqui
      canal.entregar()             ← fetch, timeout 10s
      falha → attempts++ , nextAttemptAt = now + BACKOFF_MIN[attempts-1]
```

---

## External Research

### TOTP em Node — estado das bibliotecas (consulta ao registry npm em 2026-08-04)

| Pacote | Latest | Publicado | Veredito |
|---|---|---|---|
| `otplib` | **13.4.1** | 2026-05-30 | Mantido, recém-revivido |
| `otpauth` | **9.5.1** | 2026-04-25 | Mantido, cadência regular |
| `speakeasy` | 2.0.0 | **2016-01-27** | Abandonado de fato (não formalmente depreciado) |

O hiato do `otplib` acabou: `12.0.1` em 2020-01-24, silêncio de **seis anos**, `13.0.0` em 2026-01-10, e dez releases até 13.4.1. A v13 é reescrita completa (fecha 31 issues, entre elas a própria `#704 Project Unmaintained`), com crypto por plugin. `node:crypto` **não foi removido** — virou opt-in em `@otplib/plugin-crypto-node`, que a matriz de compatibilidade do projeto marca como *"Recommended"* para Node. `@otplib/preset-default` está parado em 12.0.1 e **carrega deprecação no npm**, então o padrão antigo `preset-default` + `@noble/hashes` está obsoleto.

**Os dois pacotes declaram `"type": "module"` com condição `require` no exports map, mas não são equivalentes sob CJS — isso foi verificado empiricamente, instalando e executando sob Node 24:**

- **`otplib@13.4.1` não é CJS-puro.** O bundle CJS não inlina as dependências: emite `require("@noble/hashes/hmac.js")` e `require("@scure/base")`, e ambos são **ESM-only** (sem condição `require`, sem `.cjs`). Funciona no Node 24 apenas porque o `require(esm)` do Node está ligado — com `--no-experimental-require-module` reproduz o `ERR_REQUIRE_ESM` clássico. **Piso prático: Node ≥ 20.19 / ≥ 22.12.** Trocar para `@otplib/plugin-crypto-node` **não resolve**, porque `@otplib/plugin-base32-scure` continua puxando `@scure/base`.
- **`otpauth@9.5.1` é CJS-puro.** Empacota tudo em `dist/otpauth.node.cjs` com **zero** chamadas a `require()` — provado apagando `node_modules/@noble` e gerando token correto mesmo assim, e funciona sob `--no-experimental-require-module`.

O projeto roda Node 24, então os dois funcionam hoje. Mas a diferença importa para autohospedagem em Node mais antigo.

**Divergência de default que é armadilha de migração:** a tolerância de drift padrão do `otplib` é **zero** (rejeita código de ±30s sem `epochTolerance` explícito, e expressa a tolerância em **segundos**, não em passos, aceitando tuplas assimétricas); a do `otpauth` é **1** (aceita −1/0/+1 de fábrica). Guardrails do `@otplib/core`: `MIN_SECRET_BYTES 16` (lança `SecretTooShortError` abaixo disso), `RECOMMENDED_SECRET_BYTES 20`, `DEFAULT_PERIOD 30`.

Nota de API: no `otplib` v13 só o entrypoint **funcional** tem plugins ligados por padrão — `new TOTP().generate({secret})` lança `CryptoPluginMissingError`.

`speakeasy`: o README começa literalmente com `# NOT MAINTAINED`, mas **não há deprecação no npm** (zero versões com aviso), então `npm install speakeasy` não alerta nada. Sem tipos, 64 issues abertas, `base32.js@0.0.1`. O fork `@levminer/speakeasy` também está morto e **esse** sim é formalmente depreciado.

OSV: zero vulnerabilidades atuais nos três. O `otpauth` teve uma histórica já corrigida (GHSA-rmmc-8cqj-hfp3, bypass em token de um dígito, resolvida na 3.2.8).

**RFC 6238** ([texto](https://www.rfc-editor.org/rfc/rfc6238.txt)):
- §4.2 e §5.2 — passo de 30s é o default e o recomendado.
- §1.2 — SHA-256/SHA-512 são MAY; a base é HMAC-SHA-1.
- §5.2 — *"We RECOMMEND that at most one time step is allowed as the network delay"* → drift de ±1 passo, não mais.
- §5.2 — replay é normativo: *"The verifier MUST NOT accept the second attempt of the OTP after the successful validation has been issued for the first OTP."* Escopo: a proibição vale **após uma validação bem-sucedida**; não proíbe reenviar código que já falhou.
- §6 — ressincronização usa *dois* passos para trás no exemplo, chegando a *"around 89 seconds"* de drift. **Tensão interna da própria RFC:** §5.2 diz "at most one time step" (atraso de rede) e §6 usa dois (drift de relógio). São dois orçamentos distintos, e a RFC nunca os soma num número normativo.
- Dígitos: **a RFC 6238 não especifica contagem de dígitos** no corpo normativo (os vetores de teste do Apêndice B são de 8). O piso de 6 é da RFC 4226 §5.3.

**Atenção à versão do NIST — a que circula está retirada.** O **SP 800-63B-4 é final desde 2025-07-31**, e a revisão 3 foi **retirada em 2025-08-01**. A URL `pages.nist.gov/800-63-3/` continua no ar e é a revisão retirada; a atual é [`pages.nist.gov/800-63-4/sp800-63b.html`](https://pages.nist.gov/800-63-4/sp800-63b.html). Houve renumeração: OTP de fator único 5.1.4 → **3.1.4**, rate limiting 5.2.2 → **3.2.2**, resistência a replay 5.2.8 → **3.2.7**, e códigos de recuperação ganharam seção própria em **4.2.1.1**.

- Rev 4 §3.1.4.2 — *"Verifiers SHALL accept a given OTP only once while it is valid to provide replay resistance."*
- Rev 4 §3.2.2 — limite de **100** tentativas falhas consecutivas por autenticador por conta, *"by disabling that authenticator"*; e *"Authenticators that have been disabled SHALL be required to rebind to the subscriber account"*. Rev 4 acrescenta que sucesso **deve** zerar as falhas anteriores.
- Rev 4 §3.1.4.2 — rate limit é **SHALL** quando a saída tem menos de 64 bits. TOTP de 6 dígitos são ~20 bits, então o SHALL se aplica.
- Rev 4 §3.1.4.2 — *"the nonce SHALL be changed at least once every two minutes"* → passo ≤ 120s. **O NIST não dá janela numérica de drift** — qualquer número precisa ser citado da RFC 6238, não do NIST.

**Replay e rate limit são da aplicação, mas o otplib ajuda.** A v13.2.0 introduziu `afterTimeStep` exatamente para isso: *"track the time step from each successful verification and use the `afterTimeStep` parameter to reject previously used time steps"* — limite inferior **exclusivo**, e a verificação bem-sucedida devolve o `timeStep` para persistir. O guia de segurança é claro sobre o limite: *"otplib is a **stateless** library. It does not track which tokens have already been verified"* e *"This library does not implement rate limiting"*. Ou seja: a coluna de "último passo usado" é obrigação nossa; a comparação, não.

**Segredo TOTP em repouso:** fato estrutural — TOTP é HMAC simétrico, o verificador precisa do segredo **em claro no momento da verificação**. Hash é impossível por construção; a escolha real é cifrado vs texto puro. Toda implementação real devolve o segredo decifrado na verificação.

⚠️ **O NIST não exige cifrar o seed.** Não existe frase em nenhuma revisão do 800-63B pedindo seed de OTP "em forma cifrada" ou em HSM. A rev 4 §3.1.4.2 diz que as chaves simétricas *"SHALL be strongly protected against unauthorized disclosure by **access controls** that limit access to the keys to only those software components that require access"* — controle de acesso, não cifra. (A linguagem de "encrypted form / hardware-protected" existe no documento, mas para o *pepper* de senha e para chaves de autenticador sincronizável.) **A cadeia de citação defensável para "cifre o seed" é RFC 6238 §5.1 + OWASP ASVS 13.3.1**, e a ASVS nomeia o ativo exato: *"a secrets management solution, such as a key vault, is used to securely create, store, control access to, and destroy backend secrets… **keys and seeds for time-based tokens**"*, com HSM exigido só em L3.

Trade-off: cifrar protege contra dump de banco (backup vazado, réplica), não contra comprometimento do processo — a chave está na memória. **O incidente que fecha o argumento é o do LastPass (2022)**, na divulgação oficial: o backup do banco de MFA continha *"copies of LastPass Authenticator seeds"*, e *"the separately-stored decryption key was included in the secrets stolen by the threat actor during the second incident"*. Os seeds estavam cifrados e não importou, porque a chave estava no mesmo raio de explosão — é o argumento a favor de KMS/Vault sobre chave em variável de ambiente. Referência de implementação mais próxima do nosso porte: o **Authelia** cifra a coluna `totp_configurations.secret` com AES-256-GCM (`nonce|ciphertext|tag`), chave derivada por HKDF, AAD por coluna, e rotação por comando offline de re-cifra.

**URI do autenticador** ([Key Uri Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)): `otpauth://totp/Issuer:conta?secret=<base32>&issuer=…`. Defaults documentados: `algorithm` SHA1, `digits` 6 (valores 6 ou 8), `period` 30. O `qrcode` npm está em 1.5.4 (2024-08-05), **não empacota tipos** (exige `@types/qrcode`) e arrasta `yargs@^15` mesmo em uso programático.

**Códigos de recuperação — existe norma, e ela é específica.** [NIST SP 800-63B-4 §4.2.1.1](https://pages.nist.gov/800-63-4/sp800-63b.html) ("Saved Recovery Codes"):

- *"The recovery code SHALL include at least **64 bits** from an approved random bit generator."*
- *"Saved recovery codes SHALL be stored in the subscriber account in **hashed form** using an approved one-way function."*
- *"Following the use of a saved recovery code, the CSP SHALL invalidate that recovery code and **SHALL issue a new** saved recovery code to the subscriber."*
- *"The verification of saved recovery codes SHALL be subject to the throttling requirements in Sec. 3.2.2."*

**Hash rápido ou KDF? A ASVS 5.0 6.5.2 (L2) é a frase mais limpa sobre isso:** *"…lookup secrets with less than 112 bits of entropy (19 random alphanumeric characters or 34 random digits) are hashed with an approved password storage hashing algorithm that incorporates a 32-bit random salt. **A standard hash function can be used if the secret has 112 bits of entropy or more.**"* Ou seja: **a entropia escolhida decide o algoritmo.** Acima de 112 bits, sha256 basta e é defensável por norma; abaixo, exige KDF com salt.

⚠️ **Tensão real no padrão:** um código de 64 bits (o mínimo do §4.2.1.1) fica *abaixo* de 112, então a regra do §3.1.2.2 pediria KDF salgado — enquanto o §4.2.1.1 pede apenas "hashed form using an approved one-way function". E **nenhum** dos sistemas pesquisados emite código de reposição a cada uso, como o §4.2.1.1 literalmente exige.

**O custo de N hashes por tentativa é real, não teórico.** O `devise-two-factor` (GitLab) percorre todos os hashes bcrypt armazenados a cada tentativa: 10 códigos a custo 10 ≈ 10× um verify de bcrypt **em cada palpite errado**. A OWASP nomeia o mecanismo — work factor alto vira vetor de DoS por exaustão de CPU. É exatamente por isso que o Keycloak escolheu KDF com menos iterações: *"we generate ten codes at once"*. **Entropia alta com hash rápido evita esse problema por desenho** — e é o que a ASVS 6.5.2 autoriza acima de 112 bits.

**O que as implementações fazem de fato** (levantamento verificado no código-fonte, não em blog):

| Implementação | Códigos | Formato | Bits | Armazenamento |
|---|---|---|---|---|
| GitHub | 16 | não documentado | ? | não documentado |
| Google | 10 | 8 dígitos | ~26,6 | não documentado |
| GitLab | 10 | 16 hex minúsculo | **64** | bcrypt (PBKDF2 em FIPS) |
| Keycloak | 12 | 12 × `[A-Z sem O, 1-9]` | ~61 | **sha512 sem salt** |
| Better Auth | 10 | `xxxxx-xxxxx` | ~59,5 | cifrado (XChaCha20-Poly1305) |
| django-otp | 10 | 8 Base32 minúsculo | **40** | **texto puro, coluna indexada** |
| Supabase / AWS / Authelia | **nenhum** | — | — | — |

Note que **Keycloak (~61 bits, sha512 sem salt) e django-otp (40 bits, texto puro) ficam abaixo de todos os pisos citados** — não servem de referência. GitLab (64 bits + bcrypt) é o mais próximo da norma. E três projetos maduros decidiram **não** ter código de recuperação: o Supabase recomenda registrar um segundo fator TOTP e é explícito — *"we will not be able to restore access to your account if you lose all your two-factor authentication credentials"*.

Do GitHub, o comportamento é documentado mesmo sem o formato: **16 códigos**, uso único, *"Generating a new set of recovery codes will invalidate any codes you previously generated"*. O formato `xxxxx-xxxxx` que circula **não é oficial**.

**Consequência prática para o projeto:** o `PasswordResetToken` já usa `randomBytes(32)` + sha256, o que dá 256 bits — muito acima do limiar de 112 da ASVS. Reusar esse formato para código de recuperação resolve a questão do algoritmo por construção, mas 64 caracteres hex não são transcritíveis à mão por uma pessoa. O ponto de desenho é escolher a entropia **acima de 112 bits** mantendo o código legível (≥19 alfanuméricos aleatórios, pelo texto da própria ASVS), e não descer para os 40–61 bits que as implementações populares usam.

### Assinatura de webhook — três construções distintas

| Emissor | O que entra no HMAC | Encoding | Header |
|---|---|---|---|
| **Stripe** | `timestamp` + `.` + corpo cru | hex | `Stripe-Signature: t=…,v1=…` |
| **Standard Webhooks** | `msg_id` + `.` + `timestamp` + `.` + corpo | base64 | `webhook-signature: v1,…` |
| **GitHub** | só o corpo | hex | `X-Hub-Signature-256: sha256=…` |

**Stripe** ([docs](https://docs.stripe.com/webhooks)) — verbatim: *"The `signed_payload` string is created by concatenating: The timestamp (as a string) / The character `.` / The actual JSON payload (that is, the request body)"*. Tolerância: *"Our libraries have a default tolerance of 5 minutes between the timestamp and the current time"* (300s). Corpo bruto obrigatório: *"Any manipulation to the raw body of the request causes the verification to fail."* Rotação: até 24h com dois segredos ativos e uma assinatura por segredo no mesmo header. Retry: *"up to three days with an exponential back off"*; dedup por id de evento.

**GitHub** ([docs](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)) — assina **só o corpo**, sem timestamp: o esquema **não tem defesa de replay por construção**. Exige comparação em tempo constante: *"Never use a plain `==` operator … consider using a method like `secure_compare` or `crypto.timingSafeEqual`"*. Dedup por `X-GitHub-Delivery` (GUID, reusado no redelivery). **Não faz retry.**

**Standard Webhooks** ([spec v1.0.0](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), Apache-2.0, backers Zapier/Twilio/Supabase/ngrok/Kong) — headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (lista separada por espaço, para rotação sem downtime). Aviso relevante: *"It's important that both the message id and the timestamp not be user controlled, or at the very least not be allowed to include any `.` to prevent certain attacks."* Recomenda assimétrico (ed25519, `v1a`) sobre simétrico. Idempotência: *"Use the `webhook-id` header as an idempotency key."* `410 Gone` → *"Sender should disable the webhook endpoint"*; `3xx` conta como falha.

**Números publicados de entrega:**

| Emissor | Timeout | Retry | Auto-disable |
|---|---|---|---|
| Slack | 3s | — | — |
| Shopify | 5s | 8× em 4h | Após 8 falhas consecutivas, a subscription é deletada |
| GitHub | 10s | **nenhum** | — |
| Svix | 15s | imediato/5s/5m/30m/2h/5h/10h/10h | 5 dias de falha total, com trava de ≥12h entre a primeira e a última |
| Standard Webhooks | recomenda 15–30s | ~75h acumuladas, com jitter | — |
| Stripe | não publica | "até 3 dias, exponencial" | só o e-mail de aviso é documentado |

**SSRF** ([OWASP SSRF CS](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)): *"Deny-lists are bypass-prone. Prefer allow-lists."* Faixas a bloquear: `127.0.0.0/8`, `0.0.0.0/8`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, `fe80::/10`, `fc00::/7`, `224.0.0.0/4`, `ff00::/8`. Resolver **todos** os A + AAAA e validar cada IP; desabilitar redirect. Bloquear só o IP não basta: `metadata.google.internal` também resolve o metadata do GCP. **O [`webhook-url.ts`](../../apps/api/src/modules/notifications/application/webhook-url.ts) do projeto já implementa isso**, incluindo a defesa contra DNS rebinding — falta apenas confirmar que redirect está desabilitado.

### API key pública — convenções

**Prefixo e secret scanning.** GitHub ([blog de engenharia](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/)): estrutura **prefixo + `_` + entropia + checksum**, com *"a 32-bit checksum encoded in the last 6 digits"* via CRC32 em Base62. Motivação declarada: *"many of our old authentication token formats are hex-encoded 40 character strings that are indistinguishable from other encoded data like SHA hashes"*. O [Secret scanning partner program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program) lista como boas práticas: *"A uniquely defined prefix / High entropy random strings / A 32-bit checksum"*. **O `crm_` do projeto atende a primeira; o checksum não existe** — acrescentá-lo é aditivo (muda `gerar()`, não o hash).

**Header de autenticação — não há convenção única.** [RFC 6648](https://www.rfc-editor.org/rfc/rfc6648.txt) §3 recomenda *"SHOULD NOT prefix their parameter names with 'X-'"*, o que desaconselha `X-API-Key` (mas não `Api-Key`). A Stripe ([docs](https://docs.stripe.com/api/authentication)) usa HTTP Basic como primário — *"Provide your API key as the basic auth username value"* — com Bearer como alternativa. **O projeto já usa `Authorization: Bearer` no intake**, e manter isso é coerência interna.

**Rate limit por chave.** `@nestjs/throttler` **6.5.0 é a última versão (2025-12-02) e já é a instalada.** `getTracker(req)` e `generateKey(context, suffix, name)` são sobrescrevíveis por herança **e** configuráveis por opção, resolvidos na ordem rota/classe → throttler nomeado → global — ou seja, limitar por chave em vez de IP é suporte de primeira classe. Storage default é memória; Redis é community, e a doc oficial aponta `@nest-lab/throttler-storage-redis` (1.2.0, 2026-02-03, exige `ioredis`). **O projeto não tem Redis hoje** — limite por chave em memória funciona em instância única, que é o deploy atual.

**Versionamento.** NestJS tem `app.enableVersioning({ type: VersioningType.URI })` nativo, e URI é o default. GitHub usa header datado `X-GitHub-Api-Version: YYYY-MM-DD`, com **410 Gone** para versão fora de suporte. O projeto já tem prefixo `/api/v1` fixo em [`main.ts:51`](../../apps/api/src/main.ts), sem `enableVersioning`.

**Paginação — cursor é a convenção dominante.** Stripe: `limit` de 1 a 100 (default 10), `starting_after`/`ending_before` são IDs de objeto, envelope `{ object: "list", data, has_more, url }`. Google [AIP-158](https://google.aip.dev/158): `page_size` + `page_token`, ambos opcionais, e regra dura — *"Page tokens provided by APIs must be opaque (but URL-safe) strings, and must not be user-parseable"*, com *"Base-64 encoding an otherwise-transparent page token is not a sufficient obfuscation mechanism."*

### LGPD — consentimento e retenção

Texto conferido em [planalto.gov.br](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm). Citações verbatim:

- **Art. 5º, XII** — *"consentimento: manifestação livre, informada e inequívoca pela qual o titular concorda com o tratamento de seus dados pessoais para uma finalidade determinada"*
- **Art. 8º, § 2º** — *"Cabe ao controlador o ônus da prova de que o consentimento foi obtido em conformidade com o disposto nesta Lei."* ← é este parágrafo, e não outro, que obriga a existir evidência armazenada
- **Art. 8º, § 4º** — *"O consentimento deverá referir-se a finalidades determinadas, e as autorizações genéricas para o tratamento de dados pessoais serão nulas."* ← um registro **por finalidade**, nunca agregado
- **Art. 8º, § 5º** — revogação *"a qualquer momento mediante manifestação expressa do titular, por procedimento gratuito e facilitado, ratificados os tratamentos realizados sob amparo do consentimento anteriormente manifestado"* ← o "ratificados" significa que sobrescrever o registro apaga a prova: revogação é linha nova, não `UPDATE`
- **Art. 8º, § 6º** e **Art. 9º, § 1º/§ 2º** — alteração das informações obriga a re-informar com destaque e permite revogar ← é a base para **versionar o texto apresentado**
- **Art. 9º** — o que precisa ter sido informado: I finalidade específica; II forma e duração; III identificação do controlador; IV contato; V uso compartilhado; VI responsabilidades; VII direitos do art. 18
- **Art. 16** — eliminação após o término, *"autorizada a conservação para as seguintes finalidades: I - cumprimento de obrigação legal ou regulatória pelo controlador; … IV - uso exclusivo do controlador, vedado seu acesso por terceiro, e desde que anonimizados os dados"*
- **Art. 18, VI e IX** — direito a eliminação dos dados tratados com consentimento e a revogação do consentimento
- **Art. 37** — *"O controlador e o operador devem manter registro das operações de tratamento de dados pessoais que realizarem, especialmente quando baseado no legítimo interesse."*
- **Art. 19, II** — prazo de 15 dias aplica-se à **confirmação/acesso**, não à eliminação nem à revogação. **A LGPD não fixa prazo em dias para atender revogação.**

**Guia Orientativo da ANPD sobre Cookies** (out/2022) — a declaração mais concreta da autoridade sobre registrar consentimento: *"compete ao controlador a responsabilidade de comprovar que o consentimento foi obtido com respeito a todos os parâmetros estabelecidos pela LGPD. Dessa forma, é uma boa prática o registro e a documentação de todos os requisitos necessários para a comprovação de que o consentimento não possui vícios e contou com todas as informações necessárias."* E: *"o consentimento deve ser inequívoco, o que demanda … não se admitindo a sua inferência ou a obtenção de forma tácita ou a partir de uma omissão do titular"*; a ausência de informação sobre o **período de retenção** *"viola a exigência legal de que o consentimento deve ser informado"*.

**Campos que a lei implica guardar** (derivação ancorada, não checklist publicado por autoridade):

| Campo | Base |
|---|---|
| Identidade do titular | Art. 8º § 2º |
| **Finalidade determinada** (uma linha por finalidade) | Art. 8º § 4º; Art. 9º, I |
| Timestamp | Art. 8º § 2º; Art. 6º, X |
| Evidência do **como** (canal, mecanismo de opt-in ativo, texto exibido) | Art. 8º caput; guia ANPD |
| **Versão** do texto/política apresentada | Art. 9º § 1º; Art. 8º § 6º |
| Duração/retenção informada | Art. 9º, II; guia ANPD |
| Compartilhamento com terceiro: consentimento **específico** separado | Art. 7º § 5º |
| Revogação: data e canal, **preservando o histórico** | Art. 8º § 5º; Art. 18, IX; Art. 15, III |
| Registro da operação (e, no legítimo interesse, teste de balanceamento) | Art. 37 |

**Transacional vs marketing** — a distinção **não está escrita na LGPD**; ela é leitura das bases legais do Art. 7º. Transacional cai no inciso V (*"execução de contrato ou de procedimentos preliminares … a pedido do titular"*); marketing exige consentimento (I) ou legítimo interesse (IX) com teste de balanceamento documentado. Art. 7º § 6º fecha o atalho: *"A eventual dispensa da exigência do consentimento não desobriga os agentes de tratamento das demais obrigações."*

### Descadastro técnico

**RFC 8058** ([texto](https://www.rfc-editor.org/rfc/rfc8058.html)) — one-click:
- Valor exato: `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- §3.1 — *"The List-Unsubscribe header field MUST contain one HTTPS URI"*
- §3.1 — URI autossuficiente: *"any information about the message or recipient is encoded in the URI"*; e *"The URI SHOULD include an opaque identifier or another hard-to-forge component"*
- §3.1 — *"The POST request MUST NOT include cookies, HTTP authorization, or any other context information"* e *"MUST NOT return an HTTPS redirect"*
- §4 — **DKIM obrigatório**: *"senders MUST apply at least one valid DKIM signature … The List-Unsubscribe and List-Unsubscribe-Post headers MUST be covered by the signature"*

**Prazos para honrar opt-out:**

| Regra | Prazo | Natureza |
|---|---|---|
| LGPD Art. 8º § 5º | "a qualquer momento", "gratuito e facilitado" — **sem prazo em dias** | Lei |
| CAPEM Art. 4º, VI | 2 dias úteis (via link) / 5 dias úteis (outros meios) | Autorregulamentação privada de 2010, sem força de lei |
| Gmail (FAQ) | **48 horas** | Política de provedor |
| Yahoo | 2 days | Política de provedor |

**Gmail** ([sender guidelines](https://support.google.com/mail/answer/81126) + [FAQ](https://support.google.com/a/answer/14229414)): requisitos de bulk sender valem para *"more than 5,000 messages per day"*; *"Marketing messages and subscribed messages must support one-click unsubscribe"*; e a exclusão é explícita — *"One-click unsubscribe is required only for marketing and promotional messages. Transactional messages are excluded from this requirement. Some examples of transactional messages are password reset messages, reservation confirmations, and form submission confirmations."* Ressalva do próprio Google: *"Message recipients, not Google, determine the nature of the messages they receive."* Desde novembro de 2025 a aplicação é mais dura: *"Gmail is ramping up its enforcement on non-compliant traffic."*

**CAPEM Art. 4º, VIII** é a única regra brasileira que separa explicitamente os dois: *"Não será obrigatório o recurso de opt-out quando houver contrato entre o Remetente e o Destinatário, exclusivamente para e-mails com finalidade de assegurar a execução contratual e pós-contratual referentes àquele contrato (ex.: boleto bancário, avisos e extratos)."*

### Fatos NÃO verificados — não citar como estabelecidos

1. "Prática recomendada" entre QR server-side e URI no front. **Não há fonte normativa, e duas atribuições comuns são falsas:** a MDN **não** tem aviso sobre `img-src data:`, e o *"SHOULD NOT include … `data:`"* é da **CSP2 §7, sobre `script-src`**, não da CSP3 e não sobre imagens. O argumento defensável é outro: o QR e a string Base32 são **o mesmo segredo em duas codificações**, e como a entrada manual é prática universal (GitHub, AWS), renderizar no servidor não esconde nada. O que é citável: ASVS 14.2.1 (segredo nunca em URL — e o URI `otpauth://` *contém* `?secret=`), ASVS 14.3.2 (`Cache-Control: no-store`, não `no-cache`), e OWASP Logging CS (nunca logar). Nota prática: `uqr` (zero dependências, dual CJS/ESM, SVG) é melhor encaixe que `qrcode` (1.5.4 de 2024-08, sem tipos próprios, 29 pacotes transitivos, 85 issues abertas).
2. Timeout de resposta do Stripe em segundos e limiar de auto-disable de endpoint do Stripe.
3. Cronograma por tentativa do Stripe (só "exponencial, até 3 dias" é primário).
4. Texto primário do CAPEM — o domínio `capem.com.br` **não hospeda mais o código** (hoje é site de conteúdo genérico); a versão usada é captura do Internet Archive de 2021, do documento de 2010, anterior à LGPD.
5. A ANPD **não publicou** orientação específica sobre marketing direto por legítimo interesse (grep no guia: zero ocorrências de "marketing"/"prospec"). Não afirmar que ela endossa.
6. Headers de auth de OpenAI/GitHub/Anthropic e o `Link` header do GitHub — não fetchados.
7. Comportamento em runtime do `time2fa`; armazenamento do seed TOTP no Keycloak; Okta/NextAuth/Bitwarden; e uma frase citável do Google sobre entrada manual.
8. **Colateral relevante:** o texto consolidado do Planalto mostra o Art. 5º alterado pela MP nº 1.317/2025 e pela Lei nº 15.352/2026, que renomeiam a autoridade para "**Agência** Nacional de Proteção de Dados". Não investiguei o alcance — verificar antes de citar em documento externo ou atualizar a `PrivacidadePage`.

### Fontes que se contradizem — decidir com conhecimento da contradição

1. **ASVS 6.5.5 (L2)** exige *"for TOTP a maximum lifetime of 30 seconds"*, o que, lido ao pé da letra, **conflita** com a tolerância de ±1 passo da RFC 6238 §5.2. É preciso escolher qual seguir e registrar a escolha.
2. **A OWASP MFA Cheat Sheet está factualmente errada** sobre TOTP: diz *"a six digit number every 60 seconds"*, contra os 30s da RFC 6238. Não citar a OWASP para o passo de tempo.
3. **A ASVS 5.0 ainda referencia a revisão retirada do NIST** (800-63B rev 3) na seção V6 — não foi realinhada à rev 4.
4. As cheat sheets da OWASP são **sem data e sem versão** — citar com data de acesso (2026-08-04).
5. A **OWASP Password Storage Cheat Sheet não endossa hash rápido** para código de recuperação; ela trata só de senha e diz o oposto (*"Fast hashing algorithms such as SHA-256 are not suitable for password storage"*). Para código de recuperação, citar NIST §3.1.2.2 e ASVS 6.5.2, nunca essa página.

---

## Historical Context

**Fase 17-A** ([research](2026-07-28-fase-17a-entrada-de-lead.md) · [plan](../plans/2026-07-28-fase-17a-entrada-de-lead.md)) — construiu a máquina, deliberadamente genérica. Do Overview do plano: *"A máquina de segredo-por-registro que a Fase 19-B reservava … **nasce aqui, já genérica e com escopos** … A dependência aponta **leads → integracoes**, nunca o contrário, e é isso que permite à 19-B acrescentar escopo de webhook sem tocar em captação."*

Decisões que a 19-B **herda e não deve recontar**:
- Hash determinístico, não argon2 — a chave chega sozinha no header.
- Exibição única, e **recuperar chave perdida não existe**: *"Não é implementável com hash determinístico e não será simulada: quem perde a chave rotaciona."*
- Rotação troca o segredo da mesma linha; a anterior morre na hora, sem janela de convivência.
- Revogação preserva a linha (a tela precisa dizer que a chave existia e morreu).
- Escopo ≠ permissão: *"a chave não é 'um usuário robô'"*. Catálogos independentes de propósito.
- `prefix` expõe 32 dos 256 bits, e é o preço aceito de reconhecer a chave na tela.
- Escopo fora do catálogo é **descartado silenciosamente**, não recusado ([`integration-keys.service.ts:79`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts)).

Decisão que a 19-B **precisa rever** — plano da 17-A: *"Não há POST de criação avulsa: chave nasce junto do registro que ela credencia (hoje, o canal de captação) — chave com escopo `lead:receber` e sem canal autenticaria uma ingestão sem roteamento nem fonte, um estado que não serve para nada."*

**Fase 9** ([research](2026-07-27-fase-9-notificacoes-e-lembretes.md) · [plan](../plans/2026-07-27-fase-9-notificacoes-e-lembretes.md)) — decisão **D4**, marcada como premissa e não sugestão: *"Webhook gateado por permissão, com travas técnicas, e a URL como capability. HMAC fica para a Fase 19."* Três motivos: (1) HMAC protege o receptor contra corpo forjado, mas o risco da feature é exfiltração para fora; (2) Slack, Discord, Google Chat e Telegram *"não verificam assinatura nenhuma"*; (3) o custo era o segredo-por-registro, não a assinatura — *"Construir uma versão paralela agora é construir duas vezes"* — e *"Acrescentar assinatura depois é **aditivo** … então esperar **não gera dívida de compatibilidade**."*

O desenho já prescrito, verbatim: *"`HMAC-SHA256` sobre `<timestamp>.<body>` com o corpo cru **exatamente como enviado** (serializar uma vez, assinar e postar a mesma string — reserializar entre assinar e enviar é o bug clássico que invalida a verificação do outro lado), em `X-CRM-Signature: sha256=<hex>`, espelhando o vocabulário que o `StripeService` já consome na ponta oposta."*

E o aviso que dá nome à fronteira, do plano da Fase 9: *"**Webhook de saída do owner** (evento de negócio para sistema externo) — é a Fase 19. O `WebhookChannel` desta fase é destino **do usuário** (n8n/Slack pessoal). **A distinção precisa estar escrita, ou a Fase 19 vira retrabalho.**"*

**Fase 19-A** ([research](2026-07-28-fase-19a-lgpd-minimo.md) · [plan](../plans/2026-07-28-fase-19a-lgpd-minimo.md), `status: implemented`) — entregou portabilidade e encerramento. Adiado textualmente: *"**Consentimento, opt-out e política de retenção configurável** — Frente 19-B, por decisão de escopo do roadmap"* e *"Um direito de eliminação do colaborador sobre o *próprio* cadastro é caso da 19-B."*

Precedentes que a 19-B herda:
- `@OwnerOnly()` — *"o único portão do CRM que não é delegável"*.
- Rotas de LGPD isentas do `BillingGuard`: *"a Política de Privacidade promete os direitos 'a qualquer momento e sem custo', e um 402 aqui negaria o direito a quem mais precisa dele"*.
- I/O de rede migrou da rota para o cron (cancelamento Stripe), porque não cabe na transação de 5s.
- **Prazo não é decisão de instância** — 30 e 180 dias são constantes exportadas de propósito: *"nem uma nem outra é decisão de instância"*. **Colide com "política de retenção configurável".**
- `AuditLog` do owner é **apagado** no expurgo, não anonimizado, porque carrega PII de terceiro em `diff` — retê-la seria tratar fora das instruções (LGPD art. 42, § 1º, I).

**[Research de documentação para terceiros](2026-07-29-documentacao-para-terceiros.md)** — Lacuna 4 é sobre exatamente isto: `ENDPOINTS.md` *"se apresenta como 'referência consumível por IA' e é fonte de verdade viva do time, **não guia de integrador**"*. Falta declarada: `docs/integracoes.md` com curl ponta a ponta, ciclo de vida da credencial, a distinção escopo × permissão, e **contrato de máquina (OpenAPI/Swagger) — "Hoje não há nenhum."** Pergunta aberta desde 29/07: gerar OpenAPI a partir dos DTOs ou manter só o `ENDPOINTS.md`? Lacuna 5: sem `git tag`, sem `CHANGELOG.md`.

**Git e issues.** O módulo `integracoes` tem **dois commits**, ambos da 17-A, e nunca foi tocado depois. Nos últimos 30 commits não há nada de 19-B. Issues: [#26](https://github.com/programeai/CRM/issues/26) é o HMAC do canal `WEBHOOK` da Fase 9 (esforço M, `área: api`), [#27](https://github.com/programeai/CRM/issues/27) é o formulário público de captação (sobra da 17-A). **Nenhuma issue existe para API pública, webhook de saída do owner, 2FA ou consentimento.** O molde de epic recortado em issues numeradas está em [#31](https://github.com/programeai/CRM/issues/31) (Fase 12, 7 issues) e [#32](https://github.com/programeai/CRM/issues/32) (14-B, 3 issues).

Conteúdo de #26 que é decisão tomada: *"Essa máquina já existe … Sobra só o que é assinar"*; *"O cabeçalho `X-CRM-Timestamp` **já é enviado** — metade do insumo da assinatura está pronta"*; e a instrução explícita *"reuse; **não** construa uma segunda máquina de segredo"*. Duas propriedades a preservar: aditivo (destino sem segredo continua funcionando) e nada de segredo em log **nem em `lastError`**, *"que é gravado no banco e pode acabar num log"*.

---

## Constraints & Considerations

**Arquiteturais, do [`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md):**
- Módulo em camadas `domain/` + `application/` + `infra/` + `api/`; **não vazar `PrismaService` para dentro dos use cases** (interface no `domain/` + token DI).
- Um módulo não acessa o interior de outro — só os services que o `*.module.ts` exporta.
- Ordem dos guards globais é **imutável**: `ThrottlerGuard → JwtAuthGuard → AccessGuard → BillingGuard`, e o `OwnerContextInterceptor` depois deles.
- `ENDPOINTS.md` é **Definition of Done**: toda rota nova no mesmo PR, com os seis rótulos fixos (`Propósito`/`Auth`/`Body`/`Resposta`/`Erros`/`Handler`). PR que mexe em controller sem atualizar a doc está incompleto.
- Log: nunca `console.log`; todo log passa objeto com `evento` em pt-BR no formato `substantivo.acao_no_passado`; renomear evento existente quebra a contagem no Grafana.
- Toda mensagem visível ao usuário em pt-BR, incluindo exceções — escrita direto em pt-BR, nunca traduzida depois.

**Banco:**
- Tabela nova com `ownerId` → **RLS obrigatório** (`ENABLE` + `FORCE` + policy `owner_isolation`). O meta-teste [`test/rls.e2e-spec.ts:49`](../../apps/api/test/rls.e2e-spec.ts) quebra o build se faltar.
- Leitura antes do contexto de owner (autenticação) → `PrismaAdminService`.
- **Banco vazio não valida migration.** Portão [`scripts/validar-migrations-com-dados.sh`](../../apps/api/scripts/validar-migrations-com-dados.sh) roda no CI; migration com backfill ou troca de constraint **precisa** de invariante nova em [`prisma/fixtures/invariantes.sql`](../../apps/api/prisma/fixtures/invariantes.sql) — *"'Não estourou' é portão fraco"*. Histórico: `20260726120000_pipeline_stages_per_owner` passou verde e derrubou a API por 11 horas.
- `ALTER TYPE … ADD VALUE` é irreversível; ordem obrigatória migration → código.
- `AuditLog` tem `REVOKE UPDATE, DELETE … FROM crm_app` — qualquer retenção da trilha passa por cron + `PrismaAdminService`, como o `AccountPurgeJob`.

**Testes:**
- Rota `@Public()` nova entra em e2e **no mesmo PR** (no `auth.e2e-spec.ts` se for rota de sessão; spec próprio caso contrário, precedente `lead-intake.e2e-spec.ts`).
- Rota pública que **escreve** em tabela com RLS: o e2e precisa afirmar que a linha está no banco depois da chamada — sem contexto, o RLS não estoura, grava zero linha e a rota responde sucesso.
- Classe que fala com infraestrutura direto tem spec que a instancia de verdade.
- [`webhook.channel.spec.ts:44`](../../apps/api/src/modules/notifications/infra/webhook.channel.spec.ts) assere **exatamente os quatro headers atuais** — acrescentar `X-CRM-Signature` obriga a tocar nesse teste.

**Segurança e operação:**
- `CHAVE_SENSIVEL` ([`shared/logging/log.ts:28`](../../apps/api/src/shared/logging/log.ts)) **não** cobre `chave` nem `url`, e `msg` não é redigida. `request-context.middleware.ts:105-107` guarda o caminho cru: **chave em path vaza no log, chave em header não.**
- Segredo novo entra em `CAMPOS_OMITIDOS` ([`shared/audit-diff.ts`](../../apps/api/src/shared/audit-diff.ts)) à mão.
- `lastError` do outbox é gravado no banco — segredo não pode chegar lá.
- Nenhum lock distribuído em cron; o deploy é instância única por `container_name` fixo. Reusar o outbox e escalar depois duplica entregas.
- Não há Redis no projeto. Rate limit por chave em memória funciona no deploy atual.

**Externas:**
- TOTP exige o segredo recuperável em claro na verificação → cifra simétrica com chave de aplicação, e a rotação da chave tem de existir **antes** de ser necessária. A cadeia de citação é RFC 6238 §5.1 + ASVS 13.3.1 (o NIST pede controle de acesso, não cifra).
- Replay de código TOTP e rate limit por conta são **responsabilidade da aplicação**: nenhuma biblioteca é stateful. O `otplib` v13.2+ oferece `afterTimeStep` (limite inferior exclusivo) e devolve o `timeStep` na verificação — falta persistir uma coluna de "último passo usado" por usuário. Rate limit é **SHALL** do NIST rev 4 §3.2.2 (≤100 falhas consecutivas, desabilitando o autenticador), e o `AccessRecordKind` atual não registra falha.
- Código de recuperação tem piso normativo: **≥64 bits** (NIST rev 4 §4.2.1.1) e, para usar hash rápido em vez de KDF salgado, **≥112 bits** (ASVS 6.5.2). Escolher entropia acima de 112 bits evita tanto o KDF quanto o custo de N verificações por tentativa.
- `otplib` v13 sob CJS exige Node ≥ 20.19 / ≥ 22.12 (depende do `require(esm)`). O deploy roda Node 24, mas autohospedagem em Node antigo quebra. `otpauth` não tem essa restrição.
- One-click unsubscribe exige **DKIM cobrindo os dois headers**. Isso é configuração de DNS/SMTP, não código; e o Gmail só exige para marketing, não para transacional.

---

## Open Questions

Estas precisam de decisão humana antes do `/spec`. As cinco primeiras mudam o que se constrói.

**1. Recorte da fase. Recomendo quebrar em três, e não planejar as cinco frentes juntas.** Elas não compartilham código, não compartilham risco e não têm pré-requisito entre si — o único laço é a máquina de segredo, e ela já está pronta. Sugestão:
- **19-B-1 — Plataforma de integração:** escopo novo + `POST /integracoes/chaves` + API pública de escrita + HMAC (absorvendo a [#26](https://github.com/programeai/CRM/issues/26)) + webhook de saída. Uma frente coesa, majoritariamente aditiva, com infraestrutura pronta.
- **19-B-2 — 2FA/TOTP:** campo verde, toca o caminho crítico de login de todo mundo, dependência nova, e tem decisão de gestão de chave de cifra. Não se mistura com o resto.
- **19-B-3 — Consentimento e retenção:** campo verde, é decisão de produto e jurídica antes de ser de código, e tem duas tensões herdadas a resolver primeiro.

**2. `POST /integracoes/chaves` avulsa — a decisão da 17-A vale ainda?** Hoje chave nasce junto do registro que credencia, com motivo registrado. Uma API key de owner não tem registro-mãe. Opções: (a) criar a rota avulsa e aceitar que o motivo da 17-A era específico de `lead:receber`; (b) inventar um registro-mãe artificial ("aplicação"/"integração") para a chave pendurar. Recomendo (a), documentando que a restrição era do escopo de lead, não da máquina.

**3. Qual é a superfície da API pública?** Esta é a pergunta que originou o PRD ("um sistema interno lança eventos no pipeline de um cliente"). Precisa decidir: quais entidades são escrevíveis (`Deal`? `Activity`? `Client`? `Task`?), se há leitura ou só escrita, e a granularidade dos escopos (`negociacao:escrever` vs `pipeline:*` vs um escopo por entidade). Sem isso o `/spec` não tem contrato para especificar. Restrição dura já conhecida: cada rota de escrita passa por `executarComoOwner`, sem I/O de rede dentro.

**4. Versionamento, OpenAPI e `docs/integracoes.md` entram no escopo?** Uma API pública sem contrato de máquina e sem política de versão é dívida no dia 1 — e a Lacuna 4/5 do research de documentação já deixou a pergunta aberta desde 29/07. O prefixo `/api/v1` existe mas `enableVersioning` não está ligado.

**5. Webhook de saída: event bus novo ou chamada direta?** Não há bus hoje, e a Fase 16 reservou o motor de regras. Opções: (a) chamada direta nos 12 pontos de emissão existentes, espelhando `NotificationsService`; (b) introduzir `@nestjs/event-emitter` agora e antecipar parte da Fase 16. E, em qualquer caso: tabela de outbox nova ou reuso de `NotificationDelivery`? Reusar mistura duas features que o roadmap manda **não** confundir; tabela nova duplica a máquina de retry. Recomendo tabela própria com o mesmo desenho, e extrair o dispatcher para `shared/` se a duplicação incomodar.

**6. "Política de retenção" é configurável por owner ou constante?** A 19-A decidiu que prazo *"não é decisão de instância"* e não criou variável de ambiente nenhuma. O item do roadmap diz "política de retenção", que sugere configurável. As duas coisas não podem valer ao mesmo tempo. E qual é o alvo: lixeira (hoje cresce até alguém limpar), `AuditLog` (inapagável por `crm_app`), `Notification` (acumula para sempre), ou dado de negócio?

**7. Opt-out de quê, exatamente?** Hoje **nenhum e-mail sai para `Client` ou `Contact`** — todo destinatário é `User`. Não existe canal WhatsApp de saída (é Fase 18, P3). Ou seja, não há comunicação ao titular-terceiro de que ele possa se descadastrar. Duas leituras possíveis: (a) a 19-B só **registra** consentimento e opt-out, para o CRM ser o livro-razão que o owner consulta antes de comunicar por fora; (b) a 19-B **cria** a superfície de envio e o descadastro junto — o que é escopo bem maior, e arrasta DKIM, RFC 8058 e os 48h do Gmail. Recomendo (a) e dizer isso explicitamente na spec.

**8. A `PrivacidadePage` promete o que não existe — corrigir o texto ou implementar?** Ela cita banner de consentimento de cookies e revogação de consentimento. É decisão jurídica, não técnica, e vale resolver antes de escrever código de consentimento — porque define se a 19-B implementa a promessa ou a ajusta.

**9. 2FA: obrigatório para quem, e onde vive a chave de cifra?** Perguntas acopladas: o owner pode exigir 2FA dos colaboradores? Colaborador pode ligar por conta própria? O segredo TOTP precisa de cifra em repouso, o que introduz uma chave de aplicação nova — e a 19-A tinha o precedente de "nenhuma variável de ambiente nova". A chave em variável de ambiente é o que o LastPass provou insuficiente (a chave foi roubada junto com o backup), mas KMS/Vault é infraestrutura nova numa aplicação que hoje não tem Redis nem cofre. Vale decidir explicitamente que se aceita a chave em env var, com o motivo escrito.

Além disso: `AccessRecordKind` só registra sucesso, e o NIST rev 4 §3.2.2 exige limite de tentativas falhas por autenticador — precisa de lugar novo para registrar falha. E há uma decisão de produto embutida: **três projetos maduros (Supabase, AWS, Authelia) não têm código de recuperação**, oferecendo segundo fator ou verificação fora de banda. Ter código de recuperação é escolha, não obrigação — e é a escolha que arrasta a discussão de entropia e hash.

**9-B. Biblioteca de TOTP: `otplib` ou `otpauth`?** Decisão pequena com consequência operacional. `otplib` tem mais downloads e o `afterTimeStep` pronto para replay, mas sob CJS depende do `require(esm)` do Node (piso 20.19/22.12) e tem drift padrão **zero**. `otpauth` é CJS-puro por empacotar tudo, tem drift padrão 1 e zero issues abertas, mas não tem auxílio a replay. O deploy roda Node 24, então os dois servem — a pergunta é o quanto a autohospedagem em Node antigo importa.

**10. A [#26](https://github.com/programeai/CRM/issues/26) entra na 19-B ou sai antes, sozinha?** Ela é da Fase 9 (assinar o canal `WEBHOOK` do usuário), esforço M, e compartilha a máquina de segredo com o webhook de saída do owner. Fazer as duas juntas evita construir a assinatura duas vezes; fazer a #26 antes entrega valor menor mais cedo e valida o desenho do HMAC num caso mais simples.

**11. Quando remover o `LEAD_INTAKE_TOKEN`?** Dívida com prazo externo, não é da 19-B, mas é vizinha: depende do `site-v2` migrar para chave de integração, e a query `{stack="crm"} | evento="lead.token_legado_aceito"` diz quando é seguro. Se a 19-B for mexer no guard de intake, vale cortar no mesmo PR.

---

## Code References Index

**Máquina de chave (17-A)**
- [`apps/api/src/modules/integracoes/domain/integration-scope.ts:10-17`](../../apps/api/src/modules/integracoes/domain/integration-scope.ts) — catálogo de escopos, um único item
- [`apps/api/src/modules/integracoes/domain/integration-key.repository.ts:44`](../../apps/api/src/modules/integracoes/domain/integration-key.repository.ts) — `findByHashPeloSistema`, a porta da autenticação
- [`apps/api/src/modules/integracoes/application/integration-keys.service.ts:163`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts) — `autenticar(valor, escopoExigido)`, já genérico
- [`apps/api/src/modules/integracoes/application/integration-keys.service.ts:206-213`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts) — `gerar()` e `hash()`
- [`apps/api/src/modules/integracoes/application/integration-keys.service.ts:216-226`](../../apps/api/src/modules/integracoes/application/integration-keys.service.ts) — `paraApi()`, único caminho para a fronteira HTTP
- [`apps/api/src/modules/integracoes/api/integracoes.controller.ts:14-19`](../../apps/api/src/modules/integracoes/api/integracoes.controller.ts) — o docblock que explica a ausência de POST avulso
- [`apps/api/src/modules/integracoes/infra/prisma-integration-key.repository.ts:10-19`](../../apps/api/src/modules/integracoes/infra/prisma-integration-key.repository.ts) — `CAMPOS`, sem `keyHash`
- [`apps/api/prisma/schema.prisma:138-159`](../../apps/api/prisma/schema.prisma) — modelo `IntegrationKey`
- [`apps/api/prisma/migrations/20260811100000_integration_key/migration.sql`](../../apps/api/prisma/migrations/20260811100000_integration_key/migration.sql) — RLS e índice único do hash

**Escrita externa sob RLS**
- [`apps/api/src/prisma/prisma.service.ts:75-94`](../../apps/api/src/prisma/prisma.service.ts) — `executarComoOwner`
- [`apps/api/src/prisma/owner-context.interceptor.ts:36-52`](../../apps/api/src/prisma/owner-context.interceptor.ts) — rota pública passa sem transação
- [`apps/api/src/modules/leads/api/lead-intake-key.guard.ts:39-68`](../../apps/api/src/modules/leads/api/lead-intake-key.guard.ts) — extração do Bearer e publicação do contexto
- [`apps/api/src/modules/leads/api/intake-context.ts:27-37`](../../apps/api/src/modules/leads/api/intake-context.ts) — fail-closed se o guard sair
- [`apps/api/src/modules/leads/application/leads-intake.service.ts:75-102`](../../apps/api/src/modules/leads/application/leads-intake.service.ts) — transação e aviso pós-commit
- [`apps/api/test/lead-intake.e2e-spec.ts`](../../apps/api/test/lead-intake.e2e-spec.ts) — o e2e que afirma a linha no banco

**Outbox e webhook**
- [`apps/api/src/modules/notifications/infra/webhook.channel.ts:89-108`](../../apps/api/src/modules/notifications/infra/webhook.channel.ts) — `enviar()`, onde a serialização precisa ser extraída para assinar
- [`apps/api/src/modules/notifications/application/webhook-url.ts:17-43`](../../apps/api/src/modules/notifications/application/webhook-url.ts) — anti-SSRF reusável
- [`apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts:14`](../../apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts) — `BACKOFF_MIN`
- [`apps/api/src/modules/notifications/application/notifications-dispatch.job.ts:31`](../../apps/api/src/modules/notifications/application/notifications-dispatch.job.ts) — cron de 1 minuto, sem lock
- [`apps/api/src/modules/notifications/infra/webhook.channel.spec.ts:44`](../../apps/api/src/modules/notifications/infra/webhook.channel.spec.ts) — o teste que trava os quatro headers
- [`apps/api/prisma/schema.prisma:1010-1038`](../../apps/api/prisma/schema.prisma) — `NotificationDelivery`, a linha do outbox
- [`apps/api/src/modules/billing/api/stripe-webhook.controller.ts:31`](../../apps/api/src/modules/billing/api/stripe-webhook.controller.ts) — único precedente de verificação de assinatura

**Auth e 2FA**
- [`apps/api/src/modules/auth/auth.service.ts:434-471`](../../apps/api/src/modules/auth/auth.service.ts) — `issueTokens`, o ponto de estrangulamento
- [`apps/api/src/modules/auth/auth.service.ts:104-117`](../../apps/api/src/modules/auth/auth.service.ts) — login: nada entre `argon2.verify` e a emissão
- [`apps/api/src/modules/auth/auth.service.ts:160-240`](../../apps/api/src/modules/auth/auth.service.ts) — token de uso único (geração e consumo)
- [`apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts:67-78`](../../apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts) — compare-and-swap, o padrão certo para código de recuperação
- [`apps/api/src/modules/account/application/account-deletion.service.ts:126-145`](../../apps/api/src/modules/account/application/account-deletion.service.ts) — reautenticação com `Forbidden`, nunca 401
- [`apps/api/prisma/schema.prisma:232-269`](../../apps/api/prisma/schema.prisma) — `Session`, fora do RLS de propósito
- [`apps/web/src/lib/api.ts:23-63`](../../apps/web/src/lib/api.ts) — fila single-flight de refresh

**LGPD**
- [`apps/api/src/modules/account/application/account-purge.job.ts:35`](../../apps/api/src/modules/account/application/account-purge.job.ts) — o molde de retenção
- [`apps/api/src/modules/account/infra/prisma-account-purge.repository.ts:48-126`](../../apps/api/src/modules/account/infra/prisma-account-purge.repository.ts) — cascata em ordem topológica
- [`apps/api/src/modules/auth/access-records.service.ts:10`](../../apps/api/src/modules/auth/access-records.service.ts) — `RETENCAO_REGISTRO_DE_ACESSO_DIAS = 180`
- [`apps/api/src/modules/auth/sessions-cleanup.job.ts:10`](../../apps/api/src/modules/auth/sessions-cleanup.job.ts) — `RETENCAO_SESSAO_VENCIDA_DIAS = 30`
- [`apps/api/src/shared/purge.ts:17-30`](../../apps/api/src/shared/purge.ts) — doutrina "nenhuma cascata"
- [`apps/api/prisma/schema.prisma:716-738`](../../apps/api/prisma/schema.prisma) — `AuditLog`, sem retenção e inapagável por `crm_app`
- [`apps/web/src/features/legal/PrivacidadePage.tsx:207`](../../apps/web/src/features/legal/PrivacidadePage.tsx) — a promessa de banner de consentimento

**Front**
- [`apps/web/src/features/integracoes/CaptacaoPage.tsx:237-267`](../../apps/web/src/features/integracoes/CaptacaoPage.tsx) — dialog de exibição única
- [`apps/web/src/components/ui/copy-box.tsx`](../../apps/web/src/components/ui/copy-box.tsx) — primitivo de segredo
- [`apps/web/src/features/administracao/tabs.ts:16-57`](../../apps/web/src/features/administracao/tabs.ts) — fonte única da nav de administração
- [`apps/web/src/hooks/use-can.ts:13-32`](../../apps/web/src/hooks/use-can.ts) — `useCan()`
- [`apps/api/src/shared/permissions.ts:196-201`](../../apps/api/src/shared/permissions.ts) — `integracao:gerenciar`

**Regras**
- [`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md) — camadas, log, autorização, testes, portão de migration
- [`apps/web/CLAUDE.md`](../../apps/web/CLAUDE.md) — pt-BR, labels, permissões na UI, primitivos obrigatórios
- [`apps/api/ENDPOINTS.md:362-396`](../../apps/api/ENDPOINTS.md) — seção Integrações, com a doutrina da credencial de máquina
- [`apps/api/prisma/fixtures/invariantes.sql:284-298`](../../apps/api/prisma/fixtures/invariantes.sql) — invariante de RLS
