---
date: 2026-07-27T09:51:12-03:00
researcher: claude
git_commit: 9900d69fd48c858f4033c305763d2dd4f24ebe0e
branch: main
topic: "Fase 9 — Notificações e lembretes, com entrega agnóstica ao destino (N destinos plugáveis por usuário)"
tags: [research, notifications, notificacoes, mail, crons, outbox, rls, permissions, web-topbar]
status: complete
---

# Research: Fase 9 — Notificações e lembretes

## Research Question

Implementar a Fase 9 do [ROADMAP.md](../../ROADMAP.md#L276-L290) (**P1**): central de notificações in-app (não lidas, marcar como lida); preferências por usuário; seis gatilhos (follow-up agendado vencendo, proposta a expirar, cobrança a vencer, cobrança vencida, demanda atrasada, registro atribuído a você); digest diário por e-mail; e os dois crons existentes passando a **notificar**, não só mudar status.

**Decisão de arquitetura fechada antes desta pesquisa** (é premissa, não conclusão):

- **Strategy + Registry sobre uma porta única** (ports & adapters). Interface `CanalDeNotificacao` no `domain/` (`kind`, `isEnabled()`, `entregar(destino, conteudo)`); adapters em `infra/` (`InAppChannel`, `EmailChannel`, `WebhookChannel`); registrados num array-provider sob o token `NOTIFICATION_CHANNELS` via `useFactory` + `inject`. Plugar canal novo = 1 arquivo + 1 linha no módulo. Proibido `if`/`switch` por canal fora do registry.
- **Três costuras separadas**: evento de domínio (o fato + ids) → conteúdo neutro (`{ tipo, titulo, corpo, link, dados }`) → destino (o adapter renderiza o seu formato). O core **nunca** monta HTML. O in-app é **um** canal, não o caminho privilegiado.
- `isEnabled()` segue o contrato de "serviço opcional" já usado no `MailService` (sem env, canal desligado).
- **Destino é linha, não coluna**: `UserNotificationTarget` (`userId`, `kind`, `config`, `verified`, `active`) permitindo N destinos do mesmo `kind` por usuário; opt-in como matriz **tipo × target** (não tipo × kind).
- **Transactional Outbox**: dentro da transação do `OwnerContextInterceptor` grava-se `Notification` + `NotificationDelivery` pendentes; o dispatch roda **depois do commit**, varrido por job, com retry/backoff e status por destino. Fan-out com `Promise.allSettled` — destino que falha não derruba os outros.
- Caminho dos crons (cross-owner, sem `app.owner_id`): client admin, e falha de entrega não aborta o lote — precedente `AuditService.registrarPeloSistema`.
- **Não** usar event bus (`@nestjs/event-emitter`) nem motor de regras: isso é a Fase 16.

## Summary

**É campo aberto, sem uma linha de código.** `grep -rniE 'notif|alert|reminder|preference'` em `apps/api/prisma`, `apps/api/src` e `apps/web/src` retorna apenas ruído de seed ([seed.ts:1071](../../apps/api/prisma/seed.ts#L1071), `title: 'Notificações por WhatsApp'`, item de proposta de demonstração) e componentes shadcn (`alert-dialog.tsx`, `sonner.tsx`). Nenhum modelo no schema, nenhum módulo, nenhuma permissão, nenhum evento de log. Nenhum PRD nem plano anterior toca o assunto — a única decisão registrada é a de escopo e ordem no ROADMAP, mais duas exclusões explícitas que apontam para cá ([fase-7b:82](../../specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md#L82) e [ROADMAP.md:418](../../ROADMAP.md#L418)).

**O que o código já dá de graça** é mais do que parece. O commit `123bed3` (Fase 8B) fez os dois crons pararem de trabalhar com `count` e passarem a **enumerar as linhas afetadas com `ownerId` e rótulo humano** ([prisma-payment.repository.ts:221-236](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L221-L236), [prisma-proposal.repository.ts:134-153](../../apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts#L134-L153)) — que é exatamente o payload mínimo de uma notificação. O `AuditService` é o **molde arquitetural pronto** de serviço transversal com duas superfícies (caminho humano por `prisma.db` dentro da transação do request vs. caminho de sistema por `PrismaAdminService` cross-owner), incluindo o `@Global()` + `exports: [Service]` que evita 13 `imports:` ([audit.module.ts:8-27](../../apps/api/src/modules/audit/audit.module.ts#L8-L27)). O envio de e-mail existe com templates, dark mode e escaping ([layout.ts](../../apps/api/src/mail/templates/layout.ts)), e `@nestjs/schedule` já está montado ([app.module.ts:40](../../apps/api/src/app.module.ts#L40)). Nenhuma dependência nova é necessária.

**Os bloqueios estruturais são quatro, e nenhum é o Strategy.** (1) **Notificação endereça `userId`; todo o sistema endereça `ownerId`** — a RLS chaveia em `ownerId`, os services recebem `@CurrentOwnerId()`, e dois dos seis gatilhos (`Proposal`, `Payment`) **não têm `assigneeId` nenhum**, exigindo uma cadeia de derivação de destinatário que não existe hoje. (2) **A transação do request não tem hook de post-commit** — o `OwnerContextInterceptor` devolve `from(this.prisma.$transaction(...))` ([owner-context.interceptor.ts:43-51](../../apps/api/src/prisma/owner-context.interceptor.ts#L43-L51)) e nada roda entre o commit e a resposta, o que torna o job de varredura o único mecanismo de dispatch sem tocar arquivo crítico. (3) **`MailService` nunca rejeita** — os dois métodos engolem a falha e logam ([mail.service.ts:83-92](../../apps/api/src/mail/mail.service.ts#L83-L92)), então um `EmailChannel` que delegue a ele **não consegue** distinguir enviado/desabilitado/falhou, e sem isso `NotificationDelivery.status` é decorativo. (4) **O array-provider `useFactory` + `inject` não tem um único precedente no repo** — grep por `useFactory|useValue|useExisting|forwardRef` em `apps/` retorna **zero**; os únicos providers não-triviais são `useClass`. O registry é padrão novo, e o plano precisa introduzi-lo como decisão consciente, com o comentário explicando por quê.

## Codebase Map

### Arquivos afetados

#### Cria — módulo `notifications` (API)

| Arquivo | Papel |
|---|---|
| `apps/api/src/modules/notifications/notifications.module.ts` | `@Global()`, array-provider `NOTIFICATION_CHANNELS`, `exports: [NotificationsService]` só |
| `apps/api/src/modules/notifications/domain/notification-channel.ts` | Porta `CanalDeNotificacao` + `ConteudoDeNotificacao` + `DestinoDeNotificacao` + token `NOTIFICATION_CHANNELS` |
| `apps/api/src/modules/notifications/domain/notification.repository.ts` | Token `NOTIFICATION_REPOSITORY` + interfaces (`...ListFilter` com `ownerId`/`skip`/`take`, `findManyAndCount`) |
| `apps/api/src/modules/notifications/domain/notification-target.repository.ts` | Token + CRUD de destinos por usuário |
| `apps/api/src/modules/notifications/notifications.service.ts` | Serviço transversal: `notificar()` (request, `prisma.db`) e `notificarPeloSistema()` (cron, `admin`) |
| `apps/api/src/modules/notifications/application/notifications-dispatcher.service.ts` | Registry → `Map<kind, Canal>`, fan-out `Promise.allSettled`, marca cada `NotificationDelivery` |
| `apps/api/src/modules/notifications/application/notifications-query.service.ts` | Inbox paginado + marcar como lida + contagem de não lidas |
| `apps/api/src/modules/notifications/application/notification-content.ts` | Tipo → conteúdo neutro (`titulo`/`corpo`/`link`), pt-BR, **sem HTML** |
| `apps/api/src/modules/notifications/application/notifications-dispatch.job.ts` | Cron de varredura do outbox (retry/backoff) |
| `apps/api/src/modules/notifications/application/notifications-reminders.job.ts` | Cron dos gatilhos de prazo (a), (b), (c), (e) |
| `apps/api/src/modules/notifications/application/notifications-digest.job.ts` | Digest diário |
| `apps/api/src/modules/notifications/infra/in-app.channel.ts` · `email.channel.ts` · `webhook.channel.ts` | Adapters |
| `apps/api/src/modules/notifications/infra/prisma-notification.repository.ts` · `prisma-notification-target.repository.ts` | `this.prisma.db.*` com `ownerId` explícito no `where` |
| `apps/api/src/modules/notifications/api/notifications.controller.ts` + `api/dto/*.dto.ts` | Inbox, marcar lida, destinos, preferências |

#### Modifica — API

| Arquivo | O que muda | Por quê |
|---|---|---|
| [prisma/schema.prisma](../../apps/api/prisma/schema.prisma) | 3 modelos + 2–3 enums; back-relation em `User` (molde [:40-43](../../apps/api/prisma/schema.prisma#L40-L43)) | Modelo de dados é a fonte de verdade |
| `prisma/migrations/20260731100000_notifications/` | DDL + RLS + índices | Próximo timestamp da sequência (última é `20260730100000_soft_delete_lixeira`) |
| [app.module.ts:56](../../apps/api/src/app.module.ts#L56) | `NotificationsModule` no `imports`, junto de `AuditModule` | Módulo `@Global()` registrado uma vez |
| [shared/permissions.ts](../../apps/api/src/shared/permissions.ts) | **1 chave nova** para criar destino webhook, categoria `'Organização'` | **D4**; inbox/preferências/`IN_APP`/`EMAIL` ficam sem chave, como o Perfil |
| [mail.service.ts](../../apps/api/src/mail/mail.service.ts) | `private async send()` genérico que **propaga/retorna resultado** + `sendDigest()` | Hoje `Promise<void>` que nunca rejeita — bloqueio (3) |
| `mail/templates/digest.template.ts` (+ `.spec.ts`) | Template do digest | Contrato `EmailContent` |
| `mail/mail.service.spec.ts` | **Falta hoje** | [CLAUDE.md:100-111](../../apps/api/CLAUDE.md#L100-L111) exige spec real em adapter de infraestrutura |
| [finance-billing.job.ts:31-46](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L31-L46) e [:84-101](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L84-L101) | notifica junto da trilha, gatilhos (c) e (d) | Escopo declarado do ROADMAP |
| [proposals-expiration.job.ts:23-35](../../apps/api/src/modules/proposals/application/proposals-expiration.job.ts#L23-L35) | notifica junto da trilha, gatilho (b) já expirada | idem |
| [payment.repository.ts:58-63](../../apps/api/src/modules/finance/domain/payment.repository.ts#L58-L63) | `PaymentVencido` ganha `dueDate`/`amount` | O `select` atual não carrega valor nem prazo |
| [proposal.repository.ts:22-28](../../apps/api/src/modules/proposals/domain/proposal.repository.ts#L22-L28) | consulta nova "a expirar" (`validUntil BETWEEN now AND now+Nd`) | Hoje só detecta **já expirada** |
| [workspace-member.repository.ts:27-38](../../apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts#L27-L38) | `select` ganha `email` (ou método novo) | Digest precisa de e-mail; hoje só `{id,name,isOwner}` |
| [users.service.ts:73-86](../../apps/api/src/modules/users/users.service.ts#L73-L86) | provisiona destinos padrão (IN_APP + EMAIL) na criação da conta | Sem destino, ninguém recebe nada |
| Aceite de convite (`collaborators`) | idem, para colaborador | Mesmo motivo |
| **8 pontos de escrita de `assigneeId`** (ver Data Flow) | emitem gatilho (f) | Escopo declarado |
| [ENDPOINTS.md](../../apps/api/ENDPOINTS.md) | seção `## Notificações` | DoD ([CLAUDE.md:54-62](../../apps/api/CLAUDE.md#L54-L62)) |
| [docs/observabilidade.md:73-92](../../docs/observabilidade.md#L73-L92) | eventos novos na tabela | DoD |

#### Modifica — Web

| Arquivo | O que muda |
|---|---|
| Cria `apps/web/src/features/notificacoes/` (`api/{notificacoes.api.ts,hooks.ts,types.ts}` + componentes) | Central + preferências |
| [AppLayout.tsx:120](../../apps/web/src/app/AppLayout.tsx#L120) | sino com badge, antes do Tooltip do tema |
| [lib/query-keys.ts](../../apps/web/src/lib/query-keys.ts) | chaves `notificacoes.*` |
| [lib/labels.ts](../../apps/web/src/lib/labels.ts) | `NOTIFICATION_TYPE_LABELS` + `translateNotificationType` |
| hook da contagem (não o [main.tsx:13](../../apps/web/src/main.tsx#L13)) | `refetchInterval` de 30–60s só na contagem de não lidas (**D3**) — sem tocar os `defaultOptions` globais |
| Cria `components/ui/switch.tsx` **ou** usa `Checkbox` | Não existe `switch.tsx` hoje |
| [PerfilDialog.tsx:124](../../apps/web/src/features/perfil/PerfilDialog.tsx#L124) ou rota nova | Onde as preferências moram |

### Padrões existentes a seguir

**Padrão: serviço transversal com duas superfícies (é o molde do `NotificationsService`)**

```ts
// De apps/api/src/modules/audit/audit.service.ts:50-70 e :87-123
/**
 * Registra uma ação humana. Roda por `prisma.db`, ou seja **dentro da
 * transação do request** aberta pelo `OwnerContextInterceptor`: a trilha
 * commita junto com a mudança de negócio, ou nenhuma das duas commita.
 */
async registrar(entrada: EntradaDeAuditoria): Promise<void> {
  const access = this.cls.get<AccessContext>(ACCESS_CONTEXT);
  if (!access) { /* logger.warn evento: 'auditoria.sem_contexto' */ return; }
  await this.prisma.db.auditLog.create({ data: { ownerId: access.ownerId, ... } });
}

/**
 * Ao contrário de `registrar`, **engole** a exceção: um cron processa N
 * linhas de N owners, e uma trilha que falha não pode abortar o lote inteiro.
 */
async registrarPeloSistema(entrada: EntradaDeSistema): Promise<void> {
  try { await this.admin.auditLog.create({ data: { ownerId: entrada.ownerId, ... } }); }
  catch (erro) { /* logger.error evento: 'auditoria.registro_falhou' */ }
}
```

**Por que importa**: define a assinatura do par `notificar()` / `notificarPeloSistema()`, a escolha `prisma.db` vs `admin`, e a política de exceção. **Divergência necessária**: a auditoria deixa a exceção subir no caminho humano de propósito ("se a trilha não pode ser gravada, a mudança não deve ser aplicada"); notificação é o **oposto** — não pode derrubar a operação de negócio. Isso tem de estar escrito no comentário da classe, ou o próximo leitor vai "consertar" para ficar igual à auditoria.

**Padrão: módulo `@Global()` exportando só a escrita**

```ts
// De apps/api/src/modules/audit/audit.module.ts:8-27
/**
 * Global de propósito: a **escrita** da trilha é transversal e cruza módulos que
 * não têm (nem devem ter) dependência entre si — finance, proposals,
 * collaborators, clients. Importar `AuditModule` em cada um deles seria ruído
 * sem ganho de fronteira.
 *
 * Exporta **só** o `AuditService`: a leitura (controller + repositório) é
 * assunto interno deste módulo.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService, AuditQueryService,
    { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
  ],
  exports: [AuditService],
})
export class AuditModule {}
```

**Por que importa**: `NotificationsModule` tem exatamente o mesmo perfil (5 módulos vão emitir), e por ser `@Global()` os consumidores injetam sem `imports:`. Mas ele precisa de `imports: [MailModule]`, porque `MailModule` **não é global** ([mail.module.ts](../../apps/api/src/mail/mail.module.ts), 5 linhas, sem `@Global()`, hoje importado só por `auth.module.ts:12` e `collaborators.module.ts:26`).

**Padrão: repository com token DI (os três pontos)**

```ts
// domain/audit.repository.ts:3
export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

// audit.module.ts:23
{ provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },

// application/audit-query.service.ts:12-16
constructor(
  @Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository,
) {}
```

**Padrão: agregação de N tipos heterogêneos — o precedente que o repo tem hoje**

```ts
// De apps/api/src/modules/trash/infra/prisma-trash.repository.ts:38-53
const buscas: Record<TrashType, () => Promise<TrashItem[]>> = {
  CLIENT: () => this.clientes(filter.ownerId),
  CONTACT: () => this.contatos(filter.ownerId),
  ...
};
const resultados = await Promise.all(types.map((t) => buscas[t]()));
```

**Por que importa**: é o `Record<chave, fn>` — não um registry por DI. A decisão fechada substitui isso por array-provider, o que é **melhor** para o caso (um canal precisa de DI própria: `EmailChannel` injeta `MailService`, `WebhookChannel` injetaria `ConfigService`), mas é divergência de precedente e deve ser justificada no plano. A justificativa de fronteira do `trash` continua válida e citável: *"Agregar leituras de módulos diferentes num repositório de leitura é mais honesto que fazer cinco módulos exportarem services só para isso"* ([trash.service.ts:9-15](../../apps/api/src/modules/trash/application/trash.service.ts#L9-L15)).

**Padrão: RLS `owner_isolation` (SQL literal, precedente mais novo)**

```sql
-- De apps/api/prisma/migrations/20260729100000_audit_log/migration.sql:56-65
-- RLS (template owner_isolation)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "AuditLog"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

-- Imutabilidade: a aplicação só lê e acrescenta.
REVOKE UPDATE, DELETE ON "AuditLog" FROM crm_app;
```

Notas normativas do cabeçalho da mesma migration ([:1-15](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L1-L15)): `ownerId TEXT` sem cast `::uuid`; `current_setting(…, true)` é `missing_ok` → contexto ausente casa zero linhas (**fail-closed**); `USING` e `WITH CHECK` idênticos; `FORCE` sujeita o dono da tabela; `ownerId` **sem FK** para `User`; GRANT já vem do `ALTER DEFAULT PRIVILEGES` de [20260724040000_create_app_role](../../apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql). **Não copiar o `REVOKE`**: notificação precisa de `UPDATE` (`readAt`, status de entrega).

**Padrão: tabela por-usuário fora do RLS (a alternativa, e quando ela vale)**

```sql
-- De apps/api/prisma/migrations/20260728100000_sessions/migration.sql:5-16
--  * Session fica FORA do RLS, como User/OAuthAccount/PasswordResetToken: a
--    linha é criada no login (@Public), onde não existe `app.owner_id`. Uma
--    policy aqui casaria zero linhas (fail-closed) e fecharia o login.
--  * ON DELETE CASCADE: apagar o usuário apaga as sessões dele (o inverso de
--    `assigneeId`, que é dado de negócio do owner e usa SET NULL).
```

**Por que importa**: é a decisão a tomar para `UserNotificationTarget`. Critério do repo: se a linha é tocada em rota `@Public()`, fica fora do RLS (Session); se só em rota autenticada, denormaliza `ownerId` e recebe policy — inclusive quando tem FK para `User`, como `Subscription` ([20260724140000_add_subscription:35-42](../../apps/api/prisma/migrations/20260724140000_add_subscription/migration.sql#L35-L42): *"User (dono da FK) fica fora do RLS; só a tabela Subscription recebe a policy"*).

**Padrão: provisionamento na criação da conta (nested create pelo client admin)**

```ts
// De apps/api/src/modules/users/users.service.ts:73-86
async create(data: { name: string; email: string; passwordHash: string }) {
  const user = await this.admin.user.create({
    data: {
      ...data,
      acceptedAt: new Date(),
      subscription: { create: this.trialSubscription() },
      ownedRoles: { create: this.systemRole() },
      pipelineStages: { create: this.defaultStages() },   // ← destinos padrão entram aqui
    },
  });
  this.logStagesProvisioned(user.id);
  return user;
}
```

Com o comentário que explica o porquê ([:53-58](../../apps/api/src/modules/users/users.service.ts#L53-L58)): *"tem RLS e o cadastro não tem contexto de owner — entra pelo client admin, no mesmo nested create do `User` (atômico, sem `$transaction` explícito)"*.

**Padrão: job cron (o molde dos três jobs novos)**

```ts
// De apps/api/src/modules/finance/application/finance-billing.job.ts:14-46
const ATOR_ROTINA = 'Rotina diária';

@Injectable()
export class FinanceBillingJob {
  private readonly logger = new Logger(FinanceBillingJob.name);
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const now = new Date();
    const generated = await this.generateMonthly(now);
    const vencidas = await this.payments.markOverdue(now);
    // Uma linha por cobrança, com o ownerId DA COBRANÇA: o cron é cross-owner e
    // cada owner só pode enxergar as suas.
    for (const p of vencidas) {
      await this.audit.registrarPeloSistema({ ownerId: p.ownerId, actorType: 'CRON', ... });
    }
```

Log agregado por lote, sempre com guard `> 0` ([:47-60](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L47-L60)): `{ evento: 'financeiro.cobrancas_vencidas', msg: '…', quantidade: vencidas.length }`. **Nenhum dos dois jobs tem `try/catch`** — zero ocorrências de `try` nos dois arquivos. Um dispatch de notificação no mesmo `for` precisa do seu próprio `try/catch` por item, ou a primeira falha mata o resto do lote.

**Padrão: leitura cross-owner pelo client admin (select-then-updateMany)**

```ts
// De apps/api/src/modules/finance/infra/prisma-payment.repository.ts:221-236
async markOverdue(now: Date): Promise<PaymentVencido[]> {
  // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
  const where = { status: 'PENDING' as const, dueDate: { lt: now } };
  const alvos = await this.admin.payment.findMany({
    where,
    select: { id: true, ownerId: true, description: true },
  });
  if (alvos.length === 0) return [];
  await this.admin.payment.updateMany({ where, data: { status: 'OVERDUE' } });
  return alvos;
}
```

**Padrão: serviço opcional (`isEnabled()`) — três variantes**

```ts
// MailService (apps/api/src/mail/mail.service.ts:8-23) — degrada logando
/**
 * Segue o mesmo padrão de "serviço opcional" do CaptchaService/OAuth: sem
 * `SMTP_HOST` configurado, o envio é desabilitado e o conteúdo é apenas logado.
 */
isEnabled(): boolean { return Boolean(this.config.get<string>('SMTP_HOST')); }

// CaptchaService (modules/auth/captcha/captcha.service.ts:24-25) — no-op silencioso
async verify(token, remoteIp?): Promise<void> { if (!this.isEnabled()) return; }

// StripeService (modules/billing/application/stripe.service.ts:11-34) — gate composto no
// construtor + warn de configuração incoerente + throw no acesso ao client
this.enabled = billingEnabled && key.length > 0;
```

**Por que importa**: o `isEnabled()` da porta tem precedente nos três. O `WebhookChannel` é o caso mais próximo do Captcha (sem config, no-op) e o `EmailChannel` do Mail.

**Padrão: contrato de template de e-mail**

```ts
// apps/api/src/mail/templates/password-reset.template.ts:10-14 e :17
export type EmailContent = { subject: string; text: string; html: string };
export function passwordResetEmail({ resetUrl, appUrl }: Input): EmailContent
```

Helpers de [layout.ts](../../apps/api/src/mail/templates/layout.ts): `escapeHtml` (:15), `paragraph` (:35), `button` (:48), `pill` (:60), `urlBox` (:69), `divider` (:80), `renderLayout` (:98). Dark mode via `prefers-color-scheme` (:120-132) + `[data-ogsc]` para Outlook (:134-140). **`paragraph()` recebe HTML cru** — dados de negócio no digest (nome de cliente, valor) precisam de `escapeHtml` explícito, como faz [collaborator-invite.template.ts:41](../../apps/api/src/mail/templates/collaborator-invite.template.ts#L41). Spec de template é unitário puro, com um caso de injeção ([password-reset.template.spec.ts](../../apps/api/src/mail/templates/password-reset.template.spec.ts)).

**Padrão: paginação e DTO de query**

```ts
// shared/pagination.ts:15-33 — nunca montar {data,meta} à mão
const { page, limit, skip, take } = normalizePage(query.page, query.limit);
return paginated(data, total, page, limit);   // { data, meta: { total, page, limit } }

// api/dto/list-audit-query.dto.ts — extends PaginationQueryDto, @IsOptional() primeiro,
// mensagem pt-BR em TODA regra
@IsOptional()
@IsEnum(AuditEntity, { message: 'Tipo de registro inválido.' })
entity?: AuditEntity;
```

`DEFAULT_LIMIT = 20`, `MAX_LIMIT = 100` ([shared/pagination.ts](../../apps/api/src/shared/pagination.ts)).

**Padrão: controller + permissão**

```ts
// modules/trash/api/trash.controller.ts:11-14 — permissão por método (forma majoritária)
@RequirePermission('lixeira:ver')
@Get()
list(@CurrentOwnerId() ownerId: string, @Query() query: ListTrashQueryDto) {
  return this.trash.list(ownerId, query);
}
```

O 403 é derivado do `label` da permissão ([access.guard.ts:71-76](../../apps/api/src/modules/access/access.guard.ts#L71-L76)): `Você não tem permissão para ${label.toLowerCase()}.` Rota **sem** permissão específica tem precedente e justificativa em comentário de classe ([workspace-members.controller.ts:5-11](../../apps/api/src/modules/workspace/api/workspace-members.controller.ts#L5-L11), doc em [ENDPOINTS.md:884-890](../../apps/api/ENDPOINTS.md#L884-L890)).

**Padrão: spec de service (instanciação direta, sem `Test.createTestingModule`)**

```ts
// modules/audit/audit.service.spec.ts:24-38
prisma = { db: { auditLog: { create: auditLogCreate } } } as unknown as PrismaService;
admin  = { auditLog: { create: adminAuditLogCreate } } as unknown as PrismaAdminService;
cls    = { get: jest.fn(), getId: jest.fn().mockReturnValue('req-1') };
service = new AuditService(prisma, admin, cls as never);
```

`createTestingModule` aparece em **um** arquivo do projeto: [test/helpers/app.ts](../../apps/api/test/helpers/app.ts) (bootstrap e2e). Espionar `Logger` privado para asserir `evento` tem molde em [audit.service.spec.ts:72-77](../../apps/api/src/modules/audit/audit.service.spec.ts#L72-L77). Títulos de `it()` em pt-BR descrevendo a regra.

**Padrão: escopo por responsável (reuso direto no gatilho (f) e no inbox)**

```ts
// shared/record-scope.ts:12-18 e :48-61
export type AssigneeScope =
  | { kind: 'all' } | { kind: 'mine'; userId: string } | { kind: 'mineOrUnassigned'; userId: string };
export const ALL_RECORDS: AssigneeScope = { kind: 'all' };
// mineOrUnassigned → { OR: [{ assigneeId: scope.userId }, { assigneeId: null }] }
```

Com a regra de produto que define o destinatário quando não há responsável ([:8-10](../../apps/api/src/shared/record-scope.ts#L8-L10)): *"registro sem responsável é visível para todos, senão o lead novo ficaria invisível"*.

**Padrão web: hook de query + toast no componente**

```ts
// De apps/web/src/features/perfil/api/hooks.ts:20-49
export function useSessions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.auth.sessions,
    queryFn: () => perfilApi.sessions(),
    enabled: options?.enabled ?? true,
  });
}
function invalidateSessions(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.auth.sessions });
}
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => perfilApi.revokeSession(id),
    onSuccess: () => invalidateSessions(qc),
  });
}
```

```tsx
// SessoesAtivas.tsx:28-49 — toast e extração de erro ficam no componente
try {
  await revoke.mutateAsync(revoking.id);
  toast.success('Sessão encerrada.');
} catch (err) {
  toast.error(extractApiMessage(err, 'Falha ao encerrar a sessão.'));
}
```

**Padrão web: service por feature**

```ts
// De apps/web/src/features/auditoria/api/audit.api.ts:1-12 — molde de notificacoes.api.ts
export const auditApi = {
  list: (params: ListAuditParams) =>
    api.get<Paginated<AuditLog>>('/audit', { params }).then((r) => r.data),
};
```

**Padrão web: rótulo de enum**

```ts
// De apps/web/src/lib/labels.ts:9-12 e :130-141
function make<T extends string>(map: Record<T, string>) {
  return (value: T | null | undefined): string =>
    value == null ? '' : (map[value] ?? value);
}
// --- auditoria (Fase 8B) ---
export const AUDIT_ACTOR_TYPE_LABELS = { USER: 'Pessoa', CRON: 'Rotina automática', ... } as const;
export const translateAuditActorType = make(AUDIT_ACTOR_TYPE_LABELS);
```

O map é também a fonte do **tipo** ([auditoria/api/types.ts:7-9](../../apps/web/src/features/auditoria/api/types.ts#L7-L9): `keyof typeof AUDIT_ENTITY_LABELS`) e das **opções de filtro** ([AuditoriaPage.tsx:53-54](../../apps/web/src/features/auditoria/AuditoriaPage.tsx#L53-L54): `Object.keys(...)`).

**Padrão web: ponto de inserção do sino**

```tsx
// apps/web/src/app/AppLayout.tsx:118-141 — não existe Topbar.tsx; o header é inline
<header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4">
  <SidebarTrigger className="size-9 [&_svg]:size-6 [&_svg]:stroke-[1.5]" />
  <div className="ml-auto flex items-center gap-1">
    {/* ← o sino entra aqui, antes do Tooltip do tema */}
    <Tooltip>…</Tooltip>
    <DropdownMenu>…</DropdownMenu>
```

API do base-ui: `DropdownMenuTrigger`/`TooltipTrigger` recebem o botão por **`render=`**, não `asChild` ([:141-156](../../apps/web/src/app/AppLayout.tsx#L141-L156)).

**Padrão web: permissão na UI**

```ts
// apps/web/src/hooks/use-can.ts:13-32 — porta única
const { can, canAny } = useCan();
```

### Data Flow

**1. Caminho humano (gatilho (f), dentro do request)**

```
HTTP → ThrottlerGuard → JwtAuthGuard (req.user) → AccessGuard (req.access + CLS ACCESS_CONTEXT)
     → BillingGuard → OwnerContextInterceptor
          └─ prisma.$transaction:  SELECT set_config('app.owner_id', $1, true)   ← 1ª statement
             └─ Controller (@CurrentOwnerId) → Service
                  ├─ members.assertMember(ownerId, dto.assigneeId)   ← 422 se de fora
                  ├─ repo.create/update  (prisma.db → tx, sob RLS)
                  ├─ audit.registrar(...)                            (prisma.db, mesma tx)
                  └─ notifications.notificar(...)                    ← NOVO: Notification +
                                                                       NotificationDelivery(PENDING)
             └─ COMMIT  ────────────────────────────────────────────── nada roda depois: sem hook
                                                                        de post-commit
```

Referências: [app.module.ts:75-83](../../apps/api/src/app.module.ts#L75-L83) (ordem dos guards, **não alterar**), [owner-context.interceptor.ts:36-52](../../apps/api/src/prisma/owner-context.interceptor.ts#L36-L52), [access.guard.ts:59-62](../../apps/api/src/modules/access/access.guard.ts#L59-L62) (publica o `AccessContext` no CLS), [prisma.service.ts:53-55](../../apps/api/src/prisma/prisma.service.ts#L53-L55) (`get db()`).

**Consequência dura**: `prisma.db` dentro do request é `Prisma.TransactionClient` — **não tem `$transaction`, `$connect`, `$on`**. E a transação usa o timeout default do Prisma (5s; não há `isolationLevel`/`timeout` em nenhum lugar do projeto). Emitir dentro dela tem de ser **duas inserts e nada mais** — nenhum I/O de rede. É a razão técnica do outbox, independente da decisão de arquitetura.

**2. Dispatch (depois do commit, fora do request)**

```
NotificationsDispatchJob (@Cron)
  └─ repo.findPendingDeliveries()          → PrismaAdminService (cross-owner, bypassa RLS)
     └─ para cada delivery:
          canal = registry.get(delivery.kind)        ← Map montado do array NOTIFICATION_CHANNELS
          if (!canal || !canal.isEnabled()) → marca SKIPPED
          Promise.allSettled(...)  →  canal.entregar(destino, conteudo)
                                       ├─ InAppChannel   → marca a delivery entregue
                                       ├─ EmailChannel   → MailService (precisa devolver resultado)
                                       └─ WebhookChannel → POST na URL do destino
          marca SENT | FAILED (attempts++, nextAttemptAt = backoff)
```

**3. Caminho dos crons (gatilhos (a)–(e))**

```
FinanceBillingJob / ProposalsExpirationJob / NotificationsRemindersJob (todos @Cron)
  └─ repo (infra) → this.admin.<model>.findMany({ select: { id, ownerId, <rótulo> } })
     └─ for (const linha of alvos)
          audit.registrarPeloSistema({ ownerId: linha.ownerId, actorType: 'CRON', ... })
          notifications.notificarPeloSistema({ ownerId: linha.ownerId, userId: <derivado>, ... })
     └─ logger.log({ evento: '<dominio>.<acao_no_passado>', quantidade })   se > 0
```

**Fora do request não há CLS de acesso** — `cls.get(ACCESS_CONTEXT)` é `undefined` (é por isso que existe a variante `PeloSistema`), e `cls.getId()` devolve `undefined` → `requestId: null`.

**4. Os 8 pontos de escrita de `assigneeId` (gatilho (f))**

Todos precedidos por `members.assertMember(ownerId, dto.assigneeId)` — essas 8 linhas são o marcador exato dos pontos de emissão:

| Modelo | create | update | Observação |
|---|---|---|---|
| `Deal` | [deals.service.ts:74](../../apps/api/src/modules/pipeline/application/deals.service.ts#L74) → grava :88 | [:99](../../apps/api/src/modules/pipeline/application/deals.service.ts#L99) → grava :116 | `move` (:120) **não** toca `assigneeId` |
| `Task` | [tasks.service.ts:76](../../apps/api/src/modules/projects/application/tasks.service.ts#L76) → grava :94 | [:104](../../apps/api/src/modules/projects/application/tasks.service.ts#L104) → grava :118 | `move` (:122-135) não toca |
| `Activity` | [activities.service.ts:28](../../apps/api/src/modules/activities/application/activities.service.ts#L28) → grava :36 | [:67](../../apps/api/src/modules/activities/application/activities.service.ts#L67) → grava :75 | `complete` (:79-82) não toca |
| `Client` | [clients.service.ts:37-38](../../apps/api/src/modules/clients/application/clients.service.ts#L37-L38) → spread do DTO em :44 | [:81](../../apps/api/src/modules/clients/application/clients.service.ts#L81) → spread em :86 | **caso especial**: `assigneeId` chega por spread, não por linha própria |

No update de `Deal`/`Task`/`Activity` basta `dto.assigneeId !== undefined` para saber que mudou. Em `Client` é preciso comparar com o `existing` já carregado em [:82](../../apps/api/src/modules/clients/application/clients.service.ts#L82) — mesmo problema que a auditoria resolveu carregando o `antes` ([shared/audit-diff.ts](../../apps/api/src/shared/audit-diff.ts)).

### Origem do dado de cada gatilho

| Gatilho | Modelo:linhas | Condição | `ownerId` | `assigneeId` próprio | Índice pronto? | Detecção hoje |
|---|---|---|---|---|---|---|
| (a) follow-up vencendo | [Activity:428-449](../../apps/api/prisma/schema.prisma#L428-L449) | `type='FOLLOW_UP'`, `completedAt IS NULL`, `scheduledFor` na janela | escalar :430 | **sim** :442 | **não** | só leitura de dashboard ([prisma-dashboard.repository.ts:171-203](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L171-L203), **sem janela de tempo**) |
| (b) proposta a expirar | [Proposal:278-309](../../apps/api/prisma/schema.prisma#L278-L309) | `status IN (SENT,NEGOTIATING)`, `validUntil` na janela | escalar :280 | **não** → `client`/`deal` | **não** | job só detecta **já expirada** ([proposals-expiration.job.ts:23](../../apps/api/src/modules/proposals/application/proposals-expiration.job.ts#L23)) |
| (c) cobrança a vencer | [Payment:407-426](../../apps/api/prisma/schema.prisma#L407-L426) | `status='PENDING'`, `dueDate` na janela | escalar :409 | **não** → `contract.client` | **sim** `@@index([dueDate,status])` :424 | só dashboard ([:272-295](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L272-L295)) |
| (d) cobrança vencida | idem | `PENDING → OVERDUE` | escalar :409 | idem (c) | **sim** :424 | **sim** ([finance-billing.job.ts:31](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L31) + [repo:221-236](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L221-L236)) |
| (e) demanda atrasada | [Task:350-376](../../apps/api/prisma/schema.prisma#L350-L376) | `status != DONE`, `dueDate < now`, **`archivedAt IS NULL`** | escalar :352 | **sim** :367 | **não** | só dashboard ([:108-123](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L108-L123)) |
| (f) registro atribuído | `Client:195`, `Deal:264`, `Task:367`, `Activity:442` | escrita de `assigneeId` | escalar nos 4 | — | `@@index([ownerId,assigneeId])` nos 4 | 8 pontos acima |

Três observações que mudam o plano:

- **`Proposal` e `Payment` não têm `assigneeId`, e `Contract` também não.** As cadeias possíveis são `Proposal.clientId → Client.assigneeId` (`:286` → `:195`), `Proposal.dealId → Deal.assigneeId` (`:288` → `:264`) e `Payment.contractId → Contract.clientId → Client.assigneeId` (`:410` → `:381` → `:195`). Fallback final: o owner (o `ownerId` **é** o `User.id` do owner, porque owner tem `User.ownerId = null`).
- **Faltam índices para (a), (b) e (e).** Uma varredura cross-owner por `scheduledFor`/`validUntil`/`dueDate` nesses três modelos faz seq scan. Só `Payment` tem `@@index([dueDate, status])`. `Activity` tem apenas `@@index([ownerId])` e `@@index([ownerId, assigneeId])`.
- **`Task` tem soft delete** (`archivedAt:365`) e `Activity` **não tem**. O gatilho (e) precisa do filtro `ATIVO` ([shared/soft-delete.ts:11](../../apps/api/src/shared/soft-delete.ts#L11)) ou vai notificar demanda que está na lixeira.

**Nota transversal**: as queries do dashboard resolvem a workspace por **join** (`client: { ownerId }`, `project: { client: { ownerId } }`, `contract: { client: { ownerId } }`), não pelo escalar. Para cron cross-owner pelo `PrismaAdminService` use o **escalar `ownerId`** — é o que os dois jobs já fazem.

### Membros da workspace (destinatários)

```ts
// apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts:9-21
/**
 * "Membro atribuível" = o owner (ownerId nulo) **ou** um colaborador dele que já
 * aceitou o convite e está ativo. …
 * `User` não tem RLS — este `where` é a única barreira, não há policy por trás.
 */
const membersOf = (ownerId: string): Prisma.UserWhereInput => ({
  OR: [
    { id: ownerId, ownerId: null },
    { ownerId, active: true, acceptedAt: { not: null } },
  ],
});
```

`findManyByOwner` devolve só `{ id, name, isOwner }` ([:27-38](../../apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts#L27-L38)) — **não traz `email`**, que o digest precisa. `User` tem `email` (`:16`), `name` (`:15`), `active` (`:30`, não é "disabled"), `acceptedAt` (`:32`), e **não tem `updatedAt`**. Está **fora do RLS**. Alternativa com mais campos existe em [prisma-collaborator.repository.ts:11-34](../../apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts#L11-L34), mas traz só colaboradores, sem o owner.

## External Research

**Nenhuma dependência nova é necessária, e nenhuma pesquisa externa foi preciso fazer.** Confirmado em [apps/api/package.json](../../apps/api/package.json): `@nestjs/schedule ^6.1.3` (:35), `nodemailer ^9.0.3` (:45), `nestjs-cls ^6.2.1` (:44), `@prisma/client ^6.19.3` (:36). Ausentes por decisão: `@nestjs/event-emitter`, `bull`/`bullmq`, qualquer socket. Grep por `EventEmitter|event-emitter|OnEvent|bullmq|Queue` em `apps/api/src` → **zero**. No web ([apps/web/package.json](../../apps/web/package.json)): `@base-ui/react ^1.6.0`, `@tanstack/react-query ^5.101.3`, `react-router ^7.18.1`, `sonner ^2.0.7`, `lucide-react ^1.25.0` — **sem Radix** (proibido por [apps/web/CLAUDE.md:51](../../apps/web/CLAUDE.md#L51)).

O único mecanismo do Nest a usar que ainda não tem precedente no repo é o **array-provider** — API padrão do framework (`useFactory` + `inject`), sem biblioteca:

```ts
{
  provide: NOTIFICATION_CHANNELS,
  useFactory: (...canais: CanalDeNotificacao[]) => canais,
  inject: [InAppChannel, EmailChannel, WebhookChannel],
}
```

O Nest não tem multi-injeção por token (como o Angular); esta é a forma idiomática de compor a lista. Os adapters precisam estar **também** em `providers` para serem injetáveis pelo `inject`.

**Referência de padrão**: Transactional Outbox e Channel Adapter são de *Enterprise Integration Patterns* (Hohpe & Woolf) — nenhum código externo foi copiado; a implementação sai inteira dos padrões do repo mapeados acima.

## Historical Context

- **[ROADMAP.md:269-290](../../ROADMAP.md#L269-L290)** — única fonte de escopo. A ordem é decisão de produto explícita: *"A Fase 9 (notificações) vem primeiro **por decisão de produto** — é a lacuna que mais pesa no uso diário, já que hoje o sistema só informa quem está olhando a tela."* E a nota de complexidade já é uma pré-decisão: *"larga e rasa. Dois modelos novos (notificação e preferência por tipo), nenhuma integração… O custo é distribuído: seis gatilhos espalhados por módulos diferentes."* **A decisão de arquitetura desta pesquisa eleva para três modelos** (`Notification`, `NotificationDelivery`, `UserNotificationTarget`) — a divergência é consciente e é o preço de "N destinos por usuário"; vale registrar no plano.
- **[specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md:82](../../specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md#L82)** — *"Notificação de 'registro atribuído a você' — é a Fase 9"*. Escopo herdado, com o `assigneeId` já entregue.
- **[ROADMAP.md:418](../../ROADMAP.md#L418)** — Fase 16 (Automações) declara *"Depende de Fase 9 (notificar é uma das ações)"*. O `NotificationsService` vai ser consumido por um motor de regras depois: a porta precisa aceitar emissão programática, não só os seis gatilhos fixos.
- **Sobreposições a vigiar**: [ROADMAP.md:410-414](../../ROADMAP.md#L410-L414) reserva **cadência de follow-up** e **alerta de cliente inativo** para a Fase 16; [:448](../../ROADMAP.md#L448) reserva a **régua de cobrança** (avisos antes/depois do vencimento) para a Fase 18 — que é o mesmo gatilho de (c)/(d) em versão "comunicação ao cliente"; [:462](../../ROADMAP.md#L462) põe **webhooks de saída** na Fase 19 (P3). O `WebhookChannel` desta fase é destino **do usuário** (n8n pessoal), não webhook de negócio do owner — a distinção precisa estar escrita, ou a Fase 19 vira retrabalho. [README.md:40](../../README.md#L40) já promete ao público "alerta de oportunidade esfriando", que **não está** na lista dos seis gatilhos.
- **[SPEC.md:47-58](../../SPEC.md#L47-L58)** — delegou o pós-MVP ao ROADMAP; só ratifica P1. Não tem modelo, endpoint nem decisão sobre notificação. Não é insumo de desenho.
- **Git**: `123bed3 feat(auditoria): registra as mudanças sem ator humano na trilha` é o commit mais importante para esta fase — fez os crons enumerarem as linhas afetadas. `6554909 feat(acesso): publica o contexto de acesso no CLS e carrega o nome do usuário` deu `userId` + `userName` sem mudar assinatura de service. `6dc6220 docs(api): exige spec sem mock para classe de infraestrutura` endureceu a regra de teste que vale para os adapters novos. Padrão de entrega por fase: um commit `docs()` ao fim registrando rotas e eventos (`a8526fa`, `ab04344`, `d33c00f`), e um commit que marca o plano como `implemented`.
- **Convenção de log** ([docs/observabilidade.md:145-146](../../docs/observabilidade.md#L145-L146)): `evento` em `substantivo.acao_no_passado`, pt-BR, **estável** (renomear quebra a contagem histórica no Grafana). Não existe prefixo `cron.` — as rotinas logam pelo **domínio** (`financeiro.cobrancas_vencidas`, `propostas.expiradas`), então os eventos novos devem ser `notificacao.*` / `digest.*`, não `cron.*`. O único prefixo `email.` existente é `email.envio_falhou` / `email.smtp_desabilitado` ([:80](../../docs/observabilidade.md#L80)).
- **Duas regras de log que doem se ignoradas**: [:149-152](../../docs/observabilidade.md#L149-L152) — *"o texto livre de `msg` não é redigido — o Grafana é publicado na internet"*; logar título/corpo da notificação (que carrega nome de cliente e valor de cobrança) é violação. E [:156-174](../../docs/observabilidade.md#L156-L174) — *"O log não é a trilha de auditoria"*, com o precedente de que uma ação pode ter só `audit.registrar(...)` e nenhum `evento`. Marcar notificação como lida provavelmente não merece nem um nem outro.
- **Working tree pendente (5 arquivos, nada staged)** — a mudança em [ROADMAP.md](../../ROADMAP.md) **é o que cria a Fase 9** (troca as posições 9 e 10, move o bloco de notificações para antes de relatórios, reescreve a nota "Ordem do P1", corrige a dependência da Fase 16). Este PRD depende dela. Também pendentes: [request-context.middleware.ts](../../apps/api/src/shared/logging/request-context.middleware.ts) (+`normalizarRota()` com `uuid→:id`, `dígitos→:n`, `opaco 24+→:token`, e `ownerId` no `http.requisicao`) e [docs/observabilidade.md](../../docs/observabilidade.md) (seção `## Dashboard` + 4 eventos que faltavam). **Impacto direto**: se a Fase 9 expuser rota pública com token (descadastro do digest), `normalizarRota` já a trata.

## Constraints & Considerations

**Banco e RLS**

- Próxima migration: **`20260731100000_notifications`** (a última é `20260730100000_soft_delete_lixeira`; desde `20260724040000` o padrão é timestamp escrito à mão, um dia por migration, `HHMMSS=100000`).
- `Notification` e `NotificationDelivery`: `ownerId TEXT NOT NULL` denormalizado + policy `owner_isolation` + `FORCE`. **Sem** o `REVOKE` do `AuditLog` — `readAt` e status de entrega exigem `UPDATE`.
- Toda tabela filha denormaliza `ownerId` — o repo **nunca** usa policy por join/subquery ([20260724025450_denormalize_owner_id](../../apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql)).
- `@@index` sempre com `ownerId` na primeira coluna. Por **D1** o inbox filtra na `NotificationDelivery` (`kind='IN_APP'`, `readAt IS NULL`) e ordena pela `Notification`, então o índice do inbox é `[ownerId, userId, kind, readAt]` em `NotificationDelivery` — não em `Notification`. Para o outbox: `[status, nextAttemptAt]` (varredura cross-owner, **sem** `ownerId` na frente — é a exceção justificada, análoga a `Payment.@@index([dueDate,status])`). Atenção: ordenar por `Notification.createdAt` filtrando na filha custa join; se o plano quiser evitá-lo, denormalizar `createdAt` na delivery é a saída, e aí o índice vira `[ownerId, userId, kind, readAt, createdAt]`.
- Índices novos para os gatilhos sem cobertura: `Activity` (`scheduledFor`), `Task` (`dueDate`), `Proposal` (`validUntil`).
- FK para `User`: `ON DELETE CASCADE` em `UserNotificationTarget` (precedente `Session`) e no destinatário da notificação — o oposto de `assigneeId`, que usa `SET NULL` porque é dado de negócio do owner ([20260728100000_sessions:14-16](../../apps/api/prisma/migrations/20260728100000_sessions/migration.sql#L14-L16)).
- GRANT não precisa ser repetido (`ALTER DEFAULT PRIVILEGES` cobre tabela nova), mas o repo oscila e **documenta a escolha nos dois sentidos** — escolha uma e comente.

**Transação e dispatch**

- A transação do request usa o timeout **default do Prisma (5s)**; não há `isolationLevel`/`timeout` configurado em nenhum lugar. A emissão dentro dela é 2 inserts, zero I/O.
- `prisma.db` no request é `TransactionClient`: **sem `$transaction`**. Só o `PrismaAdminService` tem transação disponível fora do request.
- Não há hook de post-commit. Ou o dispatch é varrido por job, ou o `OwnerContextInterceptor` ganha um `tap()` depois do `$transaction` — arquivo crítico, com a ordem dos guards marcada como "não altere". **Recomendação: job.**
- **Colisão de cron**: os dois jobs existentes rodam ambos em `EVERY_DAY_AT_3AM`, **sem `name:` e sem `timeZone`** (nenhum uso de `SchedulerRegistry` no repo; nenhum `TZ` em compose/Dockerfile → UTC no container). Três jobs novos no mesmo horário pioram a indeterminação. Dar `name:` aos novos e escalonar horários.
- **Idempotência**: em (d) o `updateMany` commita o status antes do loop de trilha; se o processo cair no meio, a reexecução não re-emite nada (o filtro `status:'PENDING'` já não casa). Um dispatch colocado no mesmo loop herda esse "no-op no retry" — ou a notificação nasce na **mesma** operação que muda o status, ou aceita-se a perda. Precedente de dedupe explícito: `existsForDueDate` ([finance-billing.job.ts:81](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L81)).
- Gatilhos de prazo (a), (b), (c) são recorrentes por natureza: sem chave de dedupe (`(userId, tipo, entityId, janela)`), o cron diário notifica a mesma cobrança todo dia até vencer.

**E-mail**

- `MailService.sendX()` é `Promise<void>` que **nunca rejeita** — precisa de um método que devolva resultado, senão `NotificationDelivery.status` é ficção. Os dois try/catch já são copy-paste idêntico ([:75-92](../../apps/api/src/mail/mail.service.ts#L75-L92) ≡ [:130-147](../../apps/api/src/mail/mail.service.ts#L130-L147)); extrair um `private async send()` antes de virar quádruplo.
- Sem fila, sem retry, sem rate limit, sem `pool: true` no transporter. O throttle que existe hoje é **HTTP** ([auth.controller.ts:100](../../apps/api/src/modules/auth/auth.controller.ts#L100): limit 3/min no forgot-password) — um cron não passa por guard nenhum, e o limite do provedor SMTP é o único freio.
- Sem SMTP configurado, o fallback de UX atual é o painel devolver o link ([invites.service.ts:50-51](../../apps/api/src/modules/collaborators/application/invites.service.ts#L50-L51)). O digest não tem esse escape: sem SMTP, ele simplesmente não existe — e é justamente o que `isEnabled()` no canal resolve.
- `paragraph()` recebe HTML cru: dados de negócio no digest exigem `escapeHtml` explícito.
- `mail.service.spec.ts` **não existe** e [CLAUDE.md:100-111](../../apps/api/CLAUDE.md#L100-L111) exige spec que instancie de verdade adapter de infraestrutura. Dívida a fechar nesta fase, já que o e-mail passa a ser caminho de produto.

**Web**

- **Não existe `switch.tsx`** nem `scroll-area.tsx` em `components/ui/` (43 arquivos). Existem: `popover`, `dropdown-menu`, `badge`, `tabs`, `sheet`, `empty`, `skeleton`, `checkbox`, `confirm-dialog`, `modal-stack`, `table` (com `TableEmpty`), `pagination`. Rolagem no projeto é `max-h-* overflow-y-auto` ([dialog.tsx:98](../../apps/web/src/components/ui/dialog.tsx#L98)). Toggle de preferência: `Checkbox` ou criar o primitivo, conforme [apps/web/CLAUDE.md:52](../../apps/web/CLAUDE.md#L52).
- **Não existe polling, SSE ou WebSocket** — grep por `refetchInterval|EventSource|WebSocket|socket.io|setInterval` no web → zero. O `QueryClient` é criado **sem `defaultOptions`** ([main.tsx:13](../../apps/web/src/main.tsx#L13)), então `refetchOnWindowFocus` é `true` (default v5) e `staleTime` global é `0`: hoje a contagem de não lidas se atualizaria só no foco da janela. O precedente mais próximo de "pull" é `enabled` atrelado à abertura de um diálogo ([PerfilDialog.tsx:124](../../apps/web/src/features/perfil/PerfilDialog.tsx#L124)).
- `paramsSerializer: { indexes: null }` em [lib/api.ts](../../apps/web/src/lib/api.ts) — arrays viram `tipo=A&tipo=B`, relevante se a central filtrar por vários tipos.
- Rotas são imports estáticos, sem lazy. Rota sem gating vai junto do Dashboard ([router.tsx:65-68](../../apps/web/src/routes/router.tsx#L65-L68)); com gating, o molde é [:131-134](../../apps/web/src/routes/router.tsx#L131-L134).

**Segurança**

- `WebhookChannel` é **saída de dados para URL arbitrária definida pelo usuário**. Um colaborador cadastrando webhook próprio é caminho de exfiltração: o conteúdo neutro carrega nome de cliente e valor de cobrança. **Fechado em D4**: permissão própria para criar destino webhook, HTTPS obrigatório, bloqueio de IP privado/loopback (SSRF), `verified` antes de `active`, `X-CRM-Delivery` + `X-CRM-Timestamp` sem segredo, e a **URL tratada como capability** (é ela o segredo). Assinatura HMAC vai para a Fase 19, junto da máquina de segredo com rotação.
- **A URL do webhook é, ela própria, dado sensível** — mesmo sem segredo separado. `config` é `Json` e a carrega: a serialização de resposta pode devolvê-la ao dono, mas ela **não entra em log** e, se o destino virar entidade auditada, o `diff` da trilha (também `Json`) a copiaria sem cerimônia. Uma URL de webhook do Slack/Discord vazada é acesso de escrita ao canal de alguém.
- `config` do destino é `Json` e pode conter segredo (token de webhook). **Nunca** logar; e a resposta da API não deve devolvê-lo cru ([CLAUDE.md:51](../../apps/api/CLAUDE.md#L51): "nunca exponha o registro do Prisma cru quando ele contiver segredos").
- Se houver rota `@Public()` de descadastro por token, ela roda **fora** da transação e do RLS → `PrismaAdminService` explícito, e entra no `auth.e2e-spec.ts` no mesmo PR ([CLAUDE.md:106-111](../../apps/api/CLAUDE.md#L106-L111)).

**Retenção**

Notificação cresce sem limite e não tem política de expurgo no projeto (a auditoria também não — [audit_log migration:13-14](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L13-L14) registra que "uma futura política de retenção vai passar" pelo `crm_user`). Decidir se o job de varredura também poda entregas antigas, ou registrar como dívida.

## Decisões fechadas (2026-07-27)

Respondidas pelo autor do produto após a leitura deste PRD. São **premissa** para o `/spec`, não sugestão.

- **D1 — O in-app é um canal como os outros.** O inbox é `Notification ⋈ NotificationDelivery(kind='IN_APP')`, e `readAt` mora na **delivery**, não na `Notification`. Consequências obrigatórias: todo usuário precisa de destino `IN_APP` provisionado (na criação da conta e no aceite de convite), e "desligar o in-app" é desativar aquele destino — nenhuma leitura do inbox pode partir de `Notification` direto, senão a decisão se desfaz na prática.
- **D2 — Destinatário derivado.** Nos gatilhos sem `assigneeId` próprio: `Proposal` → `Client.assigneeId`, com `Deal.assigneeId` quando houver `dealId`; `Payment` → `Contract.clientId → Client.assigneeId`. Fallback final em todos: o **owner** (`ownerId` é o `User.id` do owner). Segue a mesma regra de produto já escrita para leitura em [record-scope.ts:8-10](../../apps/api/src/shared/record-scope.ts#L8-L10).
- **D3 — Atualização da central por polling.** `refetchInterval` de 30–60s **só** no hook da contagem de não lidas, mais `invalidateQueries` após marcar como lida. Sem SSE e sem WebSocket nesta fase (conexão longa atravessando o proxy da VPS, sem precedente no projeto). Se a latência incomodar, é dívida registrada, não replanejamento.
- **D4 — Webhook gateado por permissão, com travas técnicas, e a URL como capability. HMAC fica para a Fase 19.** Destino `WEBHOOK` exige permissão nova (categoria `'Organização'`); `IN_APP` e `EMAIL` não exigem nada, como o Perfil. Travas obrigatórias: HTTPS, bloqueio de IP privado/loopback (SSRF), `verified` antes de `active`, e a `config` nunca volta crua na resposta nem entra em log.
  **Sem assinatura e sem segredo-por-destino nesta fase.** A decisão foi avaliada e revertida por três motivos:
  - **Resolve o risco errado.** HMAC protege o receptor contra corpo forjado; o risco desta feature é a **exfiltração para fora** (colaborador aponta o webhook para o servidor dele e sifona nome de cliente e valor). Contra isso o que age é permissão + HTTPS + bloqueio de IP privado + `verified` — HMAC não faz nada.
  - **Não encaixa nos destinos reais.** Slack, Discord, Google Chat e Telegram **não verificam assinatura nenhuma** — a resposta deles para "como sei que é você" é a URL ser inadivinhável. O n8n verifica nativamente header estático (credencial "Header Auth"), não HMAC, que exigiria um Code node.
  - **O custo é o segredo-por-registro, não a assinatura.** Geração, exibição única, mascaramento na resposta, ausência em log e no `diff` da auditoria, rotação, recuperação. Essa máquina nasce na [Fase 19](../../ROADMAP.md#L461) junto da API key por owner **com escopos e rotação**; construir uma versão paralela agora é construir duas vezes. Acrescentar assinatura depois é **aditivo** (cabeçalho novo não quebra quem já recebe), então esperar não gera dívida de compatibilidade.

  Fica agora, de graça e sem segredo: `X-CRM-Delivery: <deliveryId>` e `X-CRM-Timestamp: <epoch>`. O `deliveryId` é o que deixa o receptor **deduplicar** — necessário, porque o outbox tem retry. A documentação do destino tem de dizer explicitamente que **a URL é o segredo**.
  Quando a Fase 19 trouxer HMAC, o desenho a usar é: `HMAC-SHA256` sobre `<timestamp>.<body>` com o corpo cru **exatamente como enviado** (serializar uma vez, assinar e postar a mesma string — reserializar entre assinar e enviar é o bug clássico que invalida a verificação do outro lado), em `X-CRM-Signature: sha256=<hex>`, espelhando o vocabulário que o `StripeService` já consome na ponta oposta (`stripe.webhooks.constructEvent`).

## Open Questions

As quatro que mudavam o desenho de fase estão fechadas acima. Estas seguem abertas, todas com recomendação. Só a primeira tem peso de desenho — as outras cinco não bloqueiam o início do plano.

1. **Formato do payload do webhook por destino.** É a decisão que a discussão sobre HMAC encobriu, e vale mais orçamento de desenho que ela. Slack quer `{ text }`, Discord quer `{ content }`, Google Chat quer `{ text }`, n8n aceita qualquer coisa. Um `WebhookChannel` genérico que POSTa o conteúdo neutro cru **não funciona em nenhum dos destinos populares** sem o usuário montar um transformador do outro lado — o que na prática significa que a feature nasce inutilizável para quem não roda n8n. Três saídas: (a) um só canal genérico, e o usuário se entende; (b) `kind` separado por serviço (`SLACK`, `DISCORD`, `WEBHOOK`), cada um um adapter — é exatamente para isso que a costura "o adapter renderiza o seu formato" existe, e o registry torna isso 1 arquivo por serviço; (c) canal genérico com um `template` opcional na `config`. **Recomendação: (b)**, começando por `WEBHOOK` genérico + `SLACK`, que é o destino mais pedido e o de payload mais simples. Custo real: cada serviço novo é um adapter, o que é o desenho pretendido, não um desvio.

2. **`UserNotificationTarget` dentro ou fora do RLS?** Critério do repo: fora se tocado em rota `@Public()` (Session), dentro se só autenticado (Subscription, mesmo com FK para `User`). **Recomendação:** dentro (`ownerId` denormalizado + `owner_isolation`), e a rota pública de descadastro — se existir — usa `PrismaAdminService` explícito. Consequência a aceitar: um usuário que seja colaborador de uma workspace tem `ownerId` bem definido, mas se o produto algum dia permitir participar de duas workspaces, o destino passa a ser por-workspace, não por-usuário.

3. **Nomenclatura dos enums.** O schema tem dois padrões: técnicos em inglês (`PaymentStatus`, `ActivityType.FOLLOW_UP`) e vocabulário da Fase 8B em pt-BR (`AuditAction.CRIAR`). **Recomendação:** ambos em inglês `SCREAMING_SNAKE_CASE` — `NotificationChannelKind` (`IN_APP | EMAIL | WEBHOOK`) por analogia a `PaymentMethod`, e `NotificationType` (`FOLLOW_UP_DUE | PROPOSAL_EXPIRING | PAYMENT_DUE | PAYMENT_OVERDUE | TASK_OVERDUE | RECORD_ASSIGNED`) por analogia a `ActivityType`. Rótulos pt-BR só em `labels.ts` e no conteúdo neutro. Notar que `AuditEntity` já contém `CLIENT|DEAL|TASK|PROPOSAL|PAYMENT` — os cinco alvos; espelhar ou reusar em vez de inventar um enum de entidade paralelo.

4. **Timezone do digest.** Os crons atuais não declaram `timeZone`, então `EVERY_DAY_AT_3AM` é 3h **UTC** = 00h BRT. Um "digest diário" à meia-noite é errado na prática. **Recomendação:** `@Cron('0 7 * * *', { name: 'notificacoes-digest', timeZone: 'America/Sao_Paulo' })` (≈4h BRT… ajustar ao horário desejado), assumindo o desvio dos jobs legados como dívida conhecida e **não** mexendo neles nesta fase.

5. **Dedupe dos gatilhos recorrentes.** Sem chave, (a)/(b)/(c) notificam a mesma entidade todo dia. **Recomendação:** unicidade `(userId, type, entityId, dedupeKey)` onde `dedupeKey` é a janela (ex.: `'D-3'`, ou a data-alvo em ISO) — mesmo espírito do `existsForDueDate`.

6. **O array-provider é padrão novo no repo (zero precedente de `useFactory`).** Não é dúvida de desenho — é dúvida de *como registrar a decisão*. **Recomendação:** comentário de bloco no `notifications.module.ts` no mesmo estilo do [audit.module.ts:8-16](../../apps/api/src/modules/audit/audit.module.ts#L8-L16), explicando que o registry existe para que plugar canal seja 1 arquivo + 1 linha, e que `if`/`switch` por canal é proibido fora dele.

7. **Três modelos vs. os "dois modelos novos" que o ROADMAP previu.** Divergência consciente de escopo declarado. **Recomendação:** atualizar a nota de complexidade do ROADMAP no commit do plano, para o documento não mentir sobre o tamanho da fase.

## Code References Index

**Transação, RLS, Prisma**
- [apps/api/src/prisma/owner-context.interceptor.ts:36-52](../../apps/api/src/prisma/owner-context.interceptor.ts#L36-L52) — transação por request, `set_config('app.owner_id', $1, true)`, rota pública sem transação
- [apps/api/src/prisma/prisma.service.ts:53-55](../../apps/api/src/prisma/prisma.service.ts#L53-L55) — `get db()`: `tx` do CLS ou `base`
- [apps/api/src/prisma/prisma-admin.service.ts:5-19](../../apps/api/src/prisma/prisma-admin.service.ts#L5-L19) — client privilegiado, uso restrito a cron/seed
- [apps/api/src/prisma/prisma.module.ts:5-10](../../apps/api/src/prisma/prisma.module.ts#L5-L10) — `@Global()`, exporta os dois clients
- [apps/api/src/app.module.ts:40](../../apps/api/src/app.module.ts#L40) — `ScheduleModule.forRoot()`
- [apps/api/src/app.module.ts:75-83](../../apps/api/src/app.module.ts#L75-L83) — ordem dos guards + interceptor
- [apps/api/prisma/migrations/20260729100000_audit_log/migration.sql:1-65](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L1-L65) — template `owner_isolation` + notas + `REVOKE`
- [apps/api/prisma/migrations/20260728100000_sessions/migration.sql:5-36](../../apps/api/prisma/migrations/20260728100000_sessions/migration.sql#L5-L36) — tabela por-usuário fora do RLS, `ON DELETE CASCADE`
- [apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql:1-21](../../apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql#L1-L21) — role `crm_app` + `ALTER DEFAULT PRIVILEGES`
- [apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:1-20](../../apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql#L1-L20) — origem do template, nota do `FORCE`

**Serviço transversal (molde)**
- [apps/api/src/modules/audit/audit.service.ts:13-38](../../apps/api/src/modules/audit/audit.service.ts#L13-L38) — `EntradaDeAuditoria` / `EntradaDeSistema`
- [apps/api/src/modules/audit/audit.service.ts:50-70](../../apps/api/src/modules/audit/audit.service.ts#L50-L70) — `registrar` (request, `prisma.db`, exceção sobe)
- [apps/api/src/modules/audit/audit.service.ts:87-123](../../apps/api/src/modules/audit/audit.service.ts#L87-L123) — `registrarPeloSistema` (cron, `admin`, engole)
- [apps/api/src/modules/audit/audit.module.ts:8-27](../../apps/api/src/modules/audit/audit.module.ts#L8-L27) — `@Global()`, exporta só a escrita
- [apps/api/src/modules/audit/domain/audit.repository.ts:1-27](../../apps/api/src/modules/audit/domain/audit.repository.ts#L1-L27) — token DI + interfaces
- [apps/api/src/modules/audit/infra/prisma-audit.repository.ts:9-15](../../apps/api/src/modules/audit/infra/prisma-audit.repository.ts#L9-L15) — `prisma.db` com `ownerId` explícito
- [apps/api/src/modules/audit/audit.service.spec.ts:24-38](../../apps/api/src/modules/audit/audit.service.spec.ts#L24-L38) — spec por instanciação direta, `cls as never`
- [apps/api/src/modules/trash/infra/prisma-trash.repository.ts:38-53](../../apps/api/src/modules/trash/infra/prisma-trash.repository.ts#L38-L53) — agregação por `Record<tipo, fn>`
- [apps/api/src/modules/trash/application/trash.service.ts:9-15](../../apps/api/src/modules/trash/application/trash.service.ts#L9-L15) — justificativa do read model agregador

**Crons e gatilhos**
- [apps/api/src/modules/finance/application/finance-billing.job.ts:14-60](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L14-L60) — molde de job, trilha por item, log agregado
- [apps/api/src/modules/finance/application/finance-billing.job.ts:67-104](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L67-L104) — geração idempotente de mensalidade
- [apps/api/src/modules/finance/infra/prisma-payment.repository.ts:221-236](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L221-L236) — `markOverdue`, select-then-updateMany
- [apps/api/src/modules/finance/domain/payment.repository.ts:58-63](../../apps/api/src/modules/finance/domain/payment.repository.ts#L58-L63) — `PaymentVencido` (a estender)
- [apps/api/src/modules/proposals/application/proposals-expiration.job.ts:9-43](../../apps/api/src/modules/proposals/application/proposals-expiration.job.ts#L9-L43) — job de expiração
- [apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts:134-153](../../apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts#L134-L153) — `expireOverdue`
- [apps/api/src/modules/finance/application/finance-billing.job.spec.ts](../../apps/api/src/modules/finance/application/finance-billing.job.spec.ts) — mock exaustivo de repositório, janela recalculada em vez de fake timers
- [apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:108-123](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L108-L123) — tarefas atrasadas (gatilho e)
- [apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:171-203](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L171-L203) — follow-ups (gatilho a), sem janela
- [apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:272-295](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L272-L295) — cobranças a vencer (gatilho c)

**Escrita de `assigneeId` (gatilho f)**
- [apps/api/src/modules/pipeline/application/deals.service.ts:74](../../apps/api/src/modules/pipeline/application/deals.service.ts#L74) e [:99](../../apps/api/src/modules/pipeline/application/deals.service.ts#L99)
- [apps/api/src/modules/projects/application/tasks.service.ts:76](../../apps/api/src/modules/projects/application/tasks.service.ts#L76) e [:104](../../apps/api/src/modules/projects/application/tasks.service.ts#L104)
- [apps/api/src/modules/activities/application/activities.service.ts:28](../../apps/api/src/modules/activities/application/activities.service.ts#L28) e [:67](../../apps/api/src/modules/activities/application/activities.service.ts#L67)
- [apps/api/src/modules/clients/application/clients.service.ts:37-38](../../apps/api/src/modules/clients/application/clients.service.ts#L37-L38) e [:81-92](../../apps/api/src/modules/clients/application/clients.service.ts#L81-L92) — caso do spread
- [apps/api/src/shared/record-scope.ts:8-18](../../apps/api/src/shared/record-scope.ts#L8-L18) e [:48-61](../../apps/api/src/shared/record-scope.ts#L48-L61) — escopo por responsável

**E-mail**
- [apps/api/src/mail/mail.service.ts:8-49](../../apps/api/src/mail/mail.service.ts#L8-L49) — serviço opcional, `from`, transporter lazy
- [apps/api/src/mail/mail.service.ts:56-92](../../apps/api/src/mail/mail.service.ts#L56-L92) — SMTP desabilitado + try/catch que engole
- [apps/api/src/mail/mail.module.ts](../../apps/api/src/mail/mail.module.ts) — **não** é `@Global()`
- [apps/api/src/mail/templates/password-reset.template.ts:10-17](../../apps/api/src/mail/templates/password-reset.template.ts#L10-L17) — `EmailContent`, contrato de template
- [apps/api/src/mail/templates/layout.ts:15-150](../../apps/api/src/mail/templates/layout.ts#L15-L150) — helpers, dark mode, `escapeHtml`
- [apps/api/src/mail/templates/collaborator-invite.template.ts:41](../../apps/api/src/mail/templates/collaborator-invite.template.ts#L41) — `escapeHtml` explícito em dado interpolado
- [apps/api/src/mail/templates/password-reset.template.spec.ts](../../apps/api/src/mail/templates/password-reset.template.spec.ts) — spec de template, caso de injeção
- [apps/api/src/config/env.validation.ts:14](../../apps/api/src/config/env.validation.ts#L14) e [:42-49](../../apps/api/src/config/env.validation.ts#L42-L49) — `FRONTEND_URL` obrigatório, bloco SMTP opcional
- [apps/api/src/modules/auth/captcha/captcha.service.ts:15-25](../../apps/api/src/modules/auth/captcha/captcha.service.ts#L15-L25) — serviço opcional no-op
- [apps/api/src/modules/billing/application/stripe.service.ts:11-34](../../apps/api/src/modules/billing/application/stripe.service.ts#L11-L34) — gate composto + throw

**Acesso, permissões, membros**
- [apps/api/src/shared/permissions.ts:14-39](../../apps/api/src/shared/permissions.ts#L14-L39) — categorias + `PermissionMeta`
- [apps/api/src/shared/permissions.ts:147-153](../../apps/api/src/shared/permissions.ts#L147-L153) — entrada `auditoria:ver` (molde)
- [apps/api/src/modules/access/access.guard.ts:59-77](../../apps/api/src/modules/access/access.guard.ts#L59-L77) — CLS + 403 derivado do `label`
- [apps/api/src/modules/access/domain/access-context.ts:13-40](../../apps/api/src/modules/access/domain/access-context.ts#L13-L40) — `AccessContext`, `ACCESS_CONTEXT`
- [apps/api/src/modules/access/application/access.service.ts:41-76](../../apps/api/src/modules/access/application/access.service.ts#L41-L76) — owner e papel `system` com todas as chaves
- [apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts:9-38](../../apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts#L9-L38) — `membersOf`, `select` sem `email`
- [apps/api/src/modules/workspace/api/workspace-members.controller.ts:5-11](../../apps/api/src/modules/workspace/api/workspace-members.controller.ts#L5-L11) — rota sem permissão, com justificativa
- [apps/api/src/modules/users/users.service.ts:53-86](../../apps/api/src/modules/users/users.service.ts#L53-L86) — provisionamento na criação da conta + `funil.estagios_provisionados`
- [apps/api/src/shared/pagination.ts:15-33](../../apps/api/src/shared/pagination.ts#L15-L33) — `normalizePage`, `paginated`
- [apps/api/src/shared/dto/pagination-query.dto.ts:1-16](../../apps/api/src/shared/dto/pagination-query.dto.ts#L1-L16) — base de DTO de query
- [apps/api/src/modules/audit/api/dto/list-audit-query.dto.ts:1-29](../../apps/api/src/modules/audit/api/dto/list-audit-query.dto.ts#L1-L29) — filtros com mensagem pt-BR
- [apps/api/src/modules/trash/api/trash.controller.ts:7-15](../../apps/api/src/modules/trash/api/trash.controller.ts#L7-L15) — controller enxuto
- [apps/api/ENDPOINTS.md:1010-1030](../../apps/api/ENDPOINTS.md#L1010-L1030) — molde de seção e de endpoint
- [apps/api/ENDPOINTS.md:884-890](../../apps/api/ENDPOINTS.md#L884-L890) — molde de rota sem permissão

**Schema**
- [apps/api/prisma/schema.prisma:13-47](../../apps/api/prisma/schema.prisma#L13-L47) — `User` (+ back-relations `:40-43`)
- [apps/api/prisma/schema.prisma:460-482](../../apps/api/prisma/schema.prisma#L460-L482) — `AuditLog` (molde de modelo transversal)
- [apps/api/prisma/schema.prisma:428-449](../../apps/api/prisma/schema.prisma#L428-L449) — `Activity`
- [apps/api/prisma/schema.prisma:407-426](../../apps/api/prisma/schema.prisma#L407-L426) — `Payment`
- [apps/api/prisma/schema.prisma:350-376](../../apps/api/prisma/schema.prisma#L350-L376) — `Task`
- [apps/api/prisma/schema.prisma:278-309](../../apps/api/prisma/schema.prisma#L278-L309) — `Proposal`
- [apps/api/prisma/schema.prisma:484-635](../../apps/api/prisma/schema.prisma#L484-L635) — bloco de enums (os dois padrões de nomenclatura)
- [apps/api/src/shared/soft-delete.ts:11](../../apps/api/src/shared/soft-delete.ts#L11) — filtro `ATIVO`

**Web**
- [apps/web/src/app/AppLayout.tsx:118-156](../../apps/web/src/app/AppLayout.tsx#L118-L156) — header inline, ponto do sino, API `render=`
- [apps/web/src/features/perfil/SessoesAtivas.tsx:13-148](../../apps/web/src/features/perfil/SessoesAtivas.tsx#L13-L148) — molde de tela de configuração por usuário
- [apps/web/src/features/perfil/api/hooks.ts:1-49](../../apps/web/src/features/perfil/api/hooks.ts#L1-L49) — molde de hooks
- [apps/web/src/features/auditoria/api/audit.api.ts:1-12](../../apps/web/src/features/auditoria/api/audit.api.ts#L1-L12) — molde de service por feature
- [apps/web/src/hooks/use-can.ts:13-32](../../apps/web/src/hooks/use-can.ts#L13-L32) — permissão na UI
- [apps/web/src/lib/labels.ts:9-12](../../apps/web/src/lib/labels.ts#L9-L12) e [:130-141](../../apps/web/src/lib/labels.ts#L130-L141) — factory `make` + bloco da Fase 8B
- [apps/web/src/lib/query-keys.ts](../../apps/web/src/lib/query-keys.ts) — padrão `all` + `list(params)`
- [apps/web/src/lib/api.ts](../../apps/web/src/lib/api.ts) — axios, refresh 401, 402 → `/assinatura`, `paramsSerializer`
- [apps/web/src/main.tsx:13](../../apps/web/src/main.tsx#L13) — `new QueryClient()` sem `defaultOptions`
- [apps/web/src/routes/router.tsx:65-68](../../apps/web/src/routes/router.tsx#L65-L68) e [:131-134](../../apps/web/src/routes/router.tsx#L131-L134) — rota sem/com gating
- [apps/web/src/components/ui/popover.tsx:38](../../apps/web/src/components/ui/popover.tsx#L38) — `Popover` disponível
- [apps/web/src/components/ui/empty.tsx:97-104](../../apps/web/src/components/ui/empty.tsx#L97-L104) — estado vazio

**Documentos normativos**
- [ROADMAP.md:269-290](../../ROADMAP.md#L269-L290) — escopo e ordem da Fase 9
- [apps/api/CLAUDE.md:36-40](../../apps/api/CLAUDE.md#L36-L40) — repository pattern
- [apps/api/CLAUDE.md:54-62](../../apps/api/CLAUDE.md#L54-L62) — `ENDPOINTS.md` como DoD
- [apps/api/CLAUDE.md:64-79](../../apps/api/CLAUDE.md#L64-L79) — log estruturado
- [apps/api/CLAUDE.md:87-98](../../apps/api/CLAUDE.md#L87-L98) — autorização, ordem dos guards
- [apps/api/CLAUDE.md:100-111](../../apps/api/CLAUDE.md#L100-L111) — o que pode e não pode ser mockado; e2e de rota pública
- [apps/web/CLAUDE.md:35-52](../../apps/web/CLAUDE.md#L35-L52) — estrutura por feature, design system antes do nativo
- [docs/observabilidade.md:73-92](../../docs/observabilidade.md#L73-L92) — catálogo de eventos
- [docs/observabilidade.md:145-174](../../docs/observabilidade.md#L145-L174) — convenção de `evento`, proibição de segredo, log ≠ auditoria
