---
date: 2026-07-28T10:34:01-03:00
researcher: claude
git_commit: 916814462bd5a9a74006c272f9b68823cb44ea3c
branch: main
topic: "Fase 17-A — Entrada de lead: chave de integração por owner, formulário público, roteamento para responsável e fonte de lead do catálogo"
tags: [research, leads, integracao, chave-de-api, captacao, catalogos, assignee, rls, rota-publica]
status: complete
---

# Research: Fase 17-A — Entrada de lead

## Research Question

Fase 17-A — Entrada de lead:
1. **Chave de integração por owner** — substituir `LEAD_INTAKE_TOKEN`/`LEAD_INTAKE_OWNER_EMAIL` do ambiente por chave com hash no banco, gerada em configurações, com exibição única e rotação.
2. **Formulário público de captação** de lead.
3. **Endpoint de intake multi-owner** com deduplicação.
4. **Roteamento do lead novo para um responsável** (Fase 7).
5. **Fonte de lead vinda do `LeadSourceCatalog`** em vez de tag crua.

Base existente: `apps/api/src/modules/leads` (`POST /leads/intake`, `LeadIntakeTokenGuard`, `LeadsIntakeService`, `nota-de-lead`, `lead-intake.e2e-spec.ts`).
Fora de escopo: e-mail ao cliente pelo CRM (17-B) e WhatsApp (17-C).

## Summary

**A ingestão de lead já existe e funciona em produção, mas é single-tenant por construção.** Todo o módulo `leads` entrou num único burst de 8 commits em 2026-07-28 00:02–00:03, **sem PRD nem plano em `specs/`** — as justificativas de projeto vivem nos docblocks do código e nas mensagens de commit, e são de qualidade de spec. `POST /leads/intake` é `@Public()` + `LeadIntakeTokenGuard` (token compartilhado de instância, comparado com `timingSafeEqual` sobre SHA-256), deduplica por dígitos do telefone, cria `Client` status `LEAD` + `Contact` principal sob `PrismaService.executarComoOwner`, e emite `LEAD_RECEIVED` **depois** do commit. O owner de destino vem de `LEAD_INTAKE_OWNER_EMAIL` no ambiente. O próprio código já documenta o caminho desta fase, em [leads-intake.service.ts:151-166](../../apps/api/src/modules/leads/application/leads-intake.service.ts#L151-L166): *"Quando a multiempresa entrar, o caminho é uma chave de integração POR owner (hash no banco, gerada na tela de configurações) e este método sai daqui — o owner passa a vir da chave apresentada, não do ambiente."*

**As cinco frentes têm custos muito diferentes.** Três são baratas e já têm padrão pronto: a chave por owner copia o molde de `CollaboratorInvite` (`randomBytes(32).toString('hex')` + `sha256` indexável + exibição única na resposta + `LinkConviteBox` para copiar); o roteamento é uma linha de `assigneeId` mais `WorkspaceMembersService.assertMember`; a fonte de lead é trocar `tags: [dto.origem]` por `sourceId` resolvido no `LeadSourceCatalog` — e existe até um resolvedor por nome pronto, o `CatalogResolver` da 14-A. **A quarta frente — formulário público — é a única com obstáculo estrutural:** CORS aceita uma única origem (`FRONTEND_URL`) e o front responde `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, então nem POST cross-origin do browser nem iframe embutido no site do owner funcionam hoje. Um formulário **hospedado em rota pública do `apps/web`** (mesma origem que a API em produção) atravessa sem tocar em nenhuma das duas travas — é a única variante gratuita.

**A fronteira com a 19-B é a parte politicamente sensível.** O `ROADMAP.md:595-604` reserva para a Fase 19 "a **máquina de segredo-por-registro** (geração, exibição única, mascaramento, ausência em log e no diff da auditoria, rotação, recuperação) — a mesma que a API key por owner precisa", e o [ENDPOINTS.md:1204](../../apps/api/ENDPOINTS.md) repete a promessa. A 17-A precisa exatamente dessa máquina, para um único escopo (aceitar lead). Isso é uma **decisão de escopo aberta**, não um detalhe: construir a máquina agora para um escopo só é o que a 19-B queria evitar duplicar. Ver [Open Questions](#open-questions).

## Codebase Map

### Afetados — backend

| Arquivo | Papel | Relevância |
|---|---|---|
| [leads-intake.service.ts](../../apps/api/src/modules/leads/application/leads-intake.service.ts) (196 l.) | Regra de ingestão | **Coração da fase.** `resolverOwner()` (`:151-195`) sai daqui; `gravar()` (`:93-149`) ganha `assigneeId` e `sourceId` |
| [lead-intake-token.guard.ts](../../apps/api/src/modules/leads/api/lead-intake-token.guard.ts) (64 l.) | Auth da rota | Passa a resolver a chave no banco e a publicar o `ownerId` no request |
| [leads-intake.controller.ts](../../apps/api/src/modules/leads/api/leads-intake.controller.ts) (34 l.) | Fronteira HTTP | `@Public()` + guard + `@Throttle(30/min)` + `@HttpCode(200)` |
| [intake-lead.dto.ts](../../apps/api/src/modules/leads/api/dto/intake-lead.dto.ts) (77 l.) | Contrato com o site | **Não mexer nos nomes** — `:12-26` avisa que quebra a captação em produção sem quebrar teste |
| [leads.module.ts](../../apps/api/src/modules/leads/leads.module.ts) | Módulo | Hoje importa só `ClientsModule` + `ContactsModule`. Precisará de `CatalogosModule`, `WorkspaceModule` e de `domain/` + `infra/` (passa a ser dono de tabela) |
| [nota-de-lead.ts](../../apps/api/src/modules/leads/application/nota-de-lead.ts) (72 l.) | Nota em `Client.notes` | Função pura; provavelmente intacta |
| [prisma/schema.prisma](../../apps/api/prisma/schema.prisma) | Modelo | Modelo novo de chave de integração (+ RLS) |
| [env.validation.ts:50-63](../../apps/api/src/config/env.validation.ts#L50-L63) | Joi | As duas variáveis do intake saem (ou viram fallback de transição) |
| [permissions.ts](../../apps/api/src/shared/permissions.ts) (253 l.) | Catálogo de permissões | Chave nova (`integracao:gerenciar`?), categoria `Organização` |
| [ENDPOINTS.md:311-321](../../apps/api/ENDPOINTS.md) | Doc obrigatória | Definition of Done; formato fixo por endpoint |
| [test/lead-intake.e2e-spec.ts](../../apps/api/test/lead-intake.e2e-spec.ts) (164 l.) | e2e | Reescrever: hoje depende de `.env.test` para token e owner |
| [test/.env.test:17-22](../../apps/api/test/.env.test) | Env de teste | As duas variáveis saem de lá |

### Afetados — frontend

| Arquivo | Papel | Relevância |
|---|---|---|
| [routes/router.tsx](../../apps/web/src/routes/router.tsx) (220 l.) | Router único | Rota pública nova (formulário) + aba nova em `/administracao` |
| [features/administracao/tabs.ts:16-55](../../apps/web/src/features/administracao/tabs.ts) | Fonte única das abas | Aba "Integrações"/"Captação" com `permission` |
| [features/organizacao/LinkConviteBox.tsx](../../apps/web/src/features/organizacao/LinkConviteBox.tsx) (59 l.) | Copiar segredo | **Único** padrão de clipboard do projeto — modelo direto para a chave |
| [features/auth/AceitarConvitePage.tsx](../../apps/web/src/features/auth/AceitarConvitePage.tsx) (160 l.) | Página pública com sessão ausente | Modelo mais próximo do formulário público (3 estados: carregando / inválido / form) |
| [features/auth/Turnstile.tsx](../../apps/web/src/features/auth/Turnstile.tsx) | Captcha | Reuso no formulário público |
| features/leads/ (novo) | Feature nova | Formulário público + tela da chave |

### Padrões a seguir

**Padrão 1 — segredo por registro (o molde é `CollaboratorInvite`)**

```prisma
// schema.prisma:77-90
model CollaboratorInvite {
  id        String    @id @default(uuid())
  ownerId   String
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique // sha256 do token bruto enviado no link
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([userId])
  @@index([ownerId])
}
```

```ts
// invites.service.ts:67-75 + :180-183
const rawToken = randomBytes(32).toString('hex');   // 32 bytes, hex (64 chars)
await this.invites.replaceForUser({ ownerId, userId, tokenHash: this.hash(rawToken), expiresAt });
const inviteUrl = this.buildUrl(rawToken);

/** Hash determinístico: permite busca indexada pelo token do link. */
private hash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
```

**Por que este e não o `Session`:** `Session.tokenHash` usa argon2 porque o `sid` vem no payload do JWT e a busca é por PK. A chave de integração chega **sozinha** no header `Authorization` — sem identificador ao lado —, então o hash tem de ser **determinístico e indexável** para virar um único `findUnique`. Comparar por argon2 exigiria varrer N chaves com N `argon2.verify`. Decisão análoga documentada em [schema.prisma:127-138](../../apps/api/prisma/schema.prisma#L127-L138).

O spec do convite afirma o não-vazamento — copiar a asserção:
```ts
// invites.service.spec.ts:81-89
expect(gravado.tokenHash).toBe(hashOf(rawToken));
expect(JSON.stringify(gravado)).not.toContain(rawToken);
```

**Padrão 2 — escrita pública sob RLS**

```ts
// prisma.service.ts:74-93
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
    this.cls.set(PRISMA_TX, anterior);   // o request segue depois do commit
  }
}
```

Duas obrigações declaradas no docblock (`:57-73`): (1) o `ownerId` vem de **onde a rota autenticou**, nunca do corpo; (2) **nada de I/O de rede dentro** — timeout default do Prisma é 5s, e a notificação sai após o commit.

Consequência para o guard novo: a resolução da chave no banco acontece **antes** de `executarComoOwner`, e `IntegrationKey` terá RLS → a leitura pré-contexto precisa do `PrismaAdminService`, exatamente como [prisma-invite.repository.ts:13](../../apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts#L13) faz para `CollaboratorInvite`. Precedente idêntico: `AccessService` usa o admin porque resolve `req.access` antes de existir contexto e `Role` tem RLS.

**Padrão 3 — validar o responsável antes de gravar**

```ts
// workspace-members.service.ts:23-37
async assertMember(ownerId: string, userId?: string | null): Promise<void> {
  if (!userId) return;
  if (!(await this.repo.isMember(ownerId, userId))) {
    throw new UnprocessableEntityException('Responsável inválido: escolha alguém da sua equipe.');
  }
}
```
```ts
// prisma-workspace-member.repository.ts:16-21 — "membro atribuível"
const membersOf = (ownerId: string): Prisma.UserWhereInput => ({
  OR: [
    { id: ownerId, ownerId: null },
    { ownerId, active: true, acceptedAt: { not: null } },
  ],
});
```
`User` não tem RLS — este `where` é a única barreira. Já é chamado nos 8 pontos de create/update dos 4 modelos com responsável; `ClientsService.create` chama em `:58`, e a ingestão hoje não passa `assigneeId`.

**Padrão 4 — item de catálogo utilizável**

```ts
// catalogos.service.ts:70-82
async assertUtilizavel(ownerId, kind, id): Promise<CatalogItem> {
  const item = await this.findOne(ownerId, kind, id);   // 404 se de outro owner
  if (!item.active) {
    throw new UnprocessableEntityException(
      `Este ${CATALOG_LABELS[kind]} foi excluído. Escolha outro ou cadastre-o novamente.`,
    );
  }
  return item;
}
```
Usado por `ClientsService.create:62` e `update:149` para `fontes-de-lead`.

**Padrão 5 — resolver nome → item de catálogo (existe, da 14-A)**

`apps/api/src/modules/data/application/catalog-resolver.ts` carrega o catálogo **com inativos** (`this.catalogos.list(ownerId, 'fontes-de-lead', true)`, `:23`) e expõe `resolver` / `desconhecidos` / `registrar` / `registrarAlias` — casamento por nome normalizado. É exatamente o problema da `origem: string` da ingestão. Decisões sobre nome desconhecido em [import.service.ts:192-227](../../apps/api/src/modules/data/application/import.service.ts#L192-L227) (ação `criar` exige `catalogo:gerenciar`).

**Padrão 6 — notificação**

`RECORD_ASSIGNED` (atribuição) exige `AccessContext` no CLS e é descartado quando destinatário == ator: `notifications.service.ts:74-85`. Na rota pública **não há ator**, então `notificar()` cairia no early-return `notificacao.sem_contexto`. `LEAD_RECEIVED` usa `notificarPeloSistema` (`:110-136`) com `ownerId` explícito. Se o lead novo nascer com responsável, avisar essa pessoa exige o caminho `PeloSistema`, não o `notificar`.

**Padrão 7 — formulário e página pública no front**

`react-hook-form` + `zod` + `zodResolver`, mensagens pt-BR no schema, `Field data-invalid` + `FieldLabel required` + `aria-invalid` + `FieldError`, `Controller` para tudo que não é `<input>` nativo, `Button` com `Spinner` e `disabled={isSubmitting}`. Página pública: `AuthLayout` com três retornos (carregando / erro `role="alert"` / conteúdo) — `AceitarConvitePage.tsx:66-159`. Chamada sem sessão usa o **mesmo** `api` do axios (o interceptor só adiciona header se houver token) — `organizacao.api.ts:47-58`.

### Data flow

**Hoje** (`POST /api/v1/leads/intake`):

```
Traefik → Nest (prefix /api/v1)
  ThrottlerGuard (30/min por IP)               ← @Throttle no controller
  JwtAuthGuard    → early-return (@Public)
  AccessGuard     → early-return (@Public)
  BillingGuard    → (sem req.access)
  LeadIntakeTokenGuard → compara Bearer com LEAD_INTAKE_TOKEN (env), timingSafeEqual(sha256)
  OwnerContextInterceptor → early-return: sem req.user/req.access, SEM transação
  ValidationPipe (whitelist + forbidNonWhitelisted) → 400 em campo desconhecido
  LeadsIntakeService.receber
    ├─ resolverOwner(): env LEAD_INTAKE_OWNER_EMAIL → prisma.db.user.findFirst({ email, ownerId: null })
    │                   ausente → 503; sem owner correspondente → 503
    ├─ executarComoOwner(ownerId):        [TRANSAÇÃO, app.owner_id setado]
    │    ├─ clients.findByPhoneDigits(ownerId, whatsapp)   ← `contains`, sem recorte de responsável
    │    ├─ existe?  clients.update(notes: empilharNota(...))        → { status: 'atualizado' }
    │    └─ não:     clients.create({ name, status: LEAD, tags: [origem], notes, phone, email?, city? })
    │                contacts.create({ name, phone, isPrimary: true, email? })  → { status: 'criado' }
    ├─ notifications.notificarPeloSistema({ ownerId, userId: ownerId, evento: LEAD_RECEIVED })  ← PÓS-COMMIT
    └─ logger.log({ evento: 'lead.ingerido' | 'lead.reingerido', clienteId, origem, qualificado })
```

**Pontos que a 17-A move:** `resolverOwner()` (env → chave no banco, resolvida no guard); `tags: [origem]` → `sourceId`; `create` sem `assigneeId` → com responsável roteado.

**Ordem que o spec de unidade fixa:** `leads-intake.service.spec.ts:42-49` mocka `executarComoOwner` registrando a ordem para provar que a notificação sai **depois** do commit. Manter.

## External Research

Nenhuma. Todas as cinco frentes são internas: a chave de integração copia um padrão do próprio repo, o roteamento e o catálogo são módulos existentes, e o formulário público usa o stack que já está no front. Não há biblioteca nova, nem API de terceiro (o WhatsApp Cloud API — a única dependência externa da Fase 17 — está fora deste recorte, na 17-C).

Único serviço externo já integrado e reaproveitável: **Cloudflare Turnstile**, via [captcha.service.ts](../../apps/api/src/modules/auth/captcha/captcha.service.ts) (`POST challenges.cloudflare.com/turnstile/v0/siteverify`; sem `TURNSTILE_SECRET_KEY` a verificação é ignorada, o que mantém dev utilizável). **Atenção:** `CaptchaService` é provider do `AuthModule` mas **não está em `exports`** ([auth.module.ts:26](../../apps/api/src/modules/auth/auth.module.ts#L26)) — reusar exige exportá-lo ou movê-lo para `shared/`. O CSP do front já libera `challenges.cloudflare.com` em `script-src`, `connect-src` e `frame-src` ([nginx.conf:74](../../apps/web/nginx.conf#L74)).

## Historical Context

**Não existe PRD nem plano de ingestão de lead em `specs/`.** Grep exaustivo por `LEAD_INTAKE`, `/leads/intake`, `PayloadLead`, `entrega-lead`, `site-v2`, `LEAD_RECEIVED`, `Meta Ads`, `Google Ads`, `formulário público`, `webhook de entrada` em `specs/**` → zero. O plano da Fase 9 **não** menciona `LEAD_RECEIVED`; o plano do canal Discord não menciona lead. A feature entrou fora da esteira `/prd → /spec → /code`.

**Os 8 commits de 2026-07-28 00:02–00:03** (nenhuma alteração posterior no módulo):

| commit | título |
|---|---|
| `4724338` | chore(leads): adiciona as variáveis da ingestão externa de lead |
| `7d268e1` | migration(notifications): adiciona o tipo LEAD_RECEIVED |
| `32d97d8` | feat(prisma): adiciona executarComoOwner para escrita sob RLS sem sessão |
| `8653d26` | feat(clients): busca cliente pelos dígitos do telefone |
| `1d23f12` | feat(notifications): monta o aviso de lead recebido |
| `ae3e6c6` | feat(leads): recebe lead capturado fora do CRM |
| `a97b00b` | test(leads): cobre a ingestão externa ponta a ponta |
| `0c86e2a` | feat(web): traduz o tipo de notificação de lead recebido |

Decisões registradas nas mensagens (todas continuam valendo):
- `ae3e6c6`: *"Não cria oportunidade: o tipo de serviço só se conhece na conversa de diagnóstico."* / *"A workspace de destino vem de LEAD_INTAKE_OWNER_EMAIL, não do corpo: aceitar owner pelo corpo seria deixar qualquer um escrever na conta de qualquer outro."*
- `8653d26` (dedup): *"Usa `contains` e não igualdade porque telefone é texto livre: o mesmo contato pode estar como +5584999398021 pela integração e como (84) 99939-8021 por quem digitou na mão. Sem recorte por responsável — a ingestão não tem sessão, e um lead repetido tem de ser reconhecido mesmo que o cadastro esteja com outra pessoa, senão a deduplicação vira duplicata."*
- `7d268e1`: *"Sétimo tipo, e o único emitido por quem não tem sessão. Também o único cuja utilidade depende de chegar em minutos: lead que espera o dono abrir o CRM já falou com outro."*
- `1d23f12`: *"Telefone e e-mail ficam de fora [do corpo do aviso]: o corpo viaja para Telegram, Slack e webhook, e dado de contato de lead não deve morar nesses históricos."*
- `a97b00b`: *"Rota pública que escreve sob RLS falha silenciosa: sem app.owner_id o banco não estoura, grava zero linha e a rota responde sucesso."*

**A premissa "single-tenant" do `resolverOwner` já estava vencida quando foi escrita.** `CLAUDE.md:58` ("uma instância atende vários owners"), `ROADMAP.md:14-15`, `README.md:31` e a decisão explícita em [specs/plans/2026-07-25-colaboradores-e-papeis.md:43](../plans/2026-07-25-colaboradores-e-papeis.md) dizem o contrário. O comentário do service é o último resquício da premissa antiga.

**A 14-A previu esta fase:** [specs/research/2026-07-27-fase-14-…:519](2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md) — *"(d) **Fase 17** (entrada de lead por webhook) precisará de dedup na criação — a detecção de ⏸️ 14-B é a base dela."* A 14-B (detecção de duplicidade) está adiada; a 17-A convive com o dedup por telefone que já existe.

**Fronteira 17-A × 19-B, nas palavras do roadmap** ([ROADMAP.md:595-604](../../ROADMAP.md)):
> **A assinatura HMAC das notificações entra aqui**, não na Fase 9: o custo não é assinar, é a **máquina de segredo-por-registro** (geração, exibição única, mascaramento, ausência em log e no diff da auditoria, rotação, recuperação) — a mesma que a API key por owner precisa.

E `ROADMAP.md:589-593`: *"Não confundir com o `WebhookChannel` da Fase 9 … São duas features distintas — tratar uma como a outra vira retrabalho."* A 19-B (API key por owner com escopos e rotação) está **adiada explicitamente** (`:73`).

**O contrato com o emissor não está documentado em lugar nenhum além do DTO.** `site-v2/src/lib/entrega-lead.ts` → tipo `PayloadLead` é citado só em [intake-lead.dto.ts:12-26](../../apps/api/src/modules/leads/api/dto/intake-lead.dto.ts#L12-L26), e o nome da variável do outro lado (`CRM_LEADS_TOKEN`) aparece uma única vez, em `.env.example:105`. O site vive **fora deste repositório**.

**Doc desatualizada, já hoje:** `docs/observabilidade.md` catalogou 30+ eventos e **nenhum `lead.*`**, embora o código emita seis (`lead.ingerido`, `lead.reingerido`, `lead.ingestao_desconfigurada`, `lead.token_recusado`, `lead.owner_nao_configurado`, `lead.owner_nao_encontrado`). `docs/deploy.md` não lista as duas variáveis do intake, apesar de o `deploy.yml` as repassar. `ROADMAP.md:527-543` tem os 6 checkboxes da Fase 17 desmarcados, incluindo o endpoint que está em produção.

## Constraints & Considerations

### Bloqueios estruturais

- **CORS aceita uma origem só.** `main.ts:81-84` → `origin: config.get<string>('FRONTEND_URL')`, `credentials: true`. Sem lista, sem callback, sem `origin: true`. Em produção front e API compartilham origem (`https://${CRM_DOMAIN}`), então **um formulário hospedado em rota pública do `apps/web` não toca CORS**. Um `fetch` do browser a partir do site do owner exigiria abrir CORS na rota de intake.
- **O front proíbe ser embutido.** `nginx.conf:66` → `X-Frame-Options: DENY`; `:74` → CSP `frame-ancestors 'none'`. Widget/iframe no site do owner exige mexer nos dois. O comentário `nginx.conf:42-43` avisa: `add_header` dentro de `location` **descarta** os herdados do `server` — o nginx substitui, não soma.
- **Nada de I/O de rede dentro de `executarComoOwner`** (timeout 5s do Prisma). Verificação de captcha e qualquer chamada externa acontecem **antes** de abrir a transação.
- **`IntegrationKey` com RLS não pode ser lida pelo client `crm_app` antes do contexto.** A resolução no guard precisa de `PrismaAdminService` (precedentes: `AccessService`, `prisma-invite.repository.ts`). Alternativa é deixar a tabela fora do RLS como `Session`/`PasswordResetToken` — mas o meta-teste [rls.e2e-spec.ts:49](../../apps/api/test/rls.e2e-spec.ts) **quebra se uma tabela nova com `ownerId` não tiver RLS ligado, forçado e com policy** (`User` é a única exceção whitelisted). Ou seja: tabela com `ownerId` → RLS obrigatório, leitura pré-contexto → admin client.

### Migration

- **Próximo número: `20260811100000`.** A última é `20260810100000_audit_import`.
- **O portão é `scripts/validar-migrations-com-dados.sh`** (CI, a cada push que toca a API): aplica o init, insere `prisma/fixtures/banco-populado.sql` (dois owners com dados) e só então o resto das migrations, terminando nas invariantes de `prisma/fixtures/invariantes.sql`. Banco vazio não valida migration — foi assim que `20260726120000_pipeline_stages_per_owner` passou no CI e derrubou a API por 11 horas. Migration que faz backfill ou troca constraint **precisa** de invariante nova.
- Rodar localmente antes do PR: `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh`
- Molde de RLS para tabela nova, de `20260805100000_lead_source_catalog/migration.sql:126-133`: `ENABLE` + `FORCE` + policy `owner_isolation` com `USING`/`WITH CHECK` sobre `current_setting('app.owner_id', true)` + `GRANT ... TO crm_app`.

### Permissão nova

Acrescentar chave em `PERMISSIONS` é só código (owner e papel `system` recebem `ALL_PERMISSION_KEYS` em runtime), mas **papéis existentes não ganham a chave sozinhos**. Precedente de backfill: `20260727100000_assignee_per_record/migration.sql:40-60` concedeu `cliente:ver_todos` etc. a papéis não-`system` que já viam o módulo. Decidir se a chave nova entra por backfill ou nasce só no owner.

### Compatibilidade da captação em produção

- O site já envia hoje com `LEAD_INTAKE_TOKEN`. Trocar o mecanismo **quebra a captação em produção** se o corte não for coordenado com o `site-v2` (repo separado). Aceitar as duas formas durante a transição — chave do banco **ou** token do ambiente — é o que evita janela de perda de lead.
- Os nomes dos campos do DTO são o contrato: `intake-lead.dto.ts:16` — *"mudar um nome aqui quebra a captação em produção sem quebrar nenhum teste"*.
- `forbidNonWhitelisted` faz campo novo enviado pelo site responder **400**. Acrescentar campo ao DTO é aditivo e seguro; remover, não.

### Observabilidade e segredo

- Log estruturado obrigatório, `evento` em pt-BR no formato `substantivo.acao_no_passado`. Renomear evento existente quebra contagem histórica no Grafana. **Os seis `lead.*` que já existem não podem ser renomeados.**
- `CHAVE_SENSIVEL` em `shared/logging/log.ts:28-29` redige automaticamente chaves que casem `/senha|password|secret|token|authorization|cookie|api[-_]?key|credential|passwordhash/i` — cobre `token` e `apiKey`, **não** cobre `chave` nem `url`. Nome de campo escolhido em pt-BR pode escapar da rede automática.
- `msg` **não** é redigida, só truncada. O Grafana é publicado e a linha vive 30 dias.
- `CAMPOS_OMITIDOS` do diff da auditoria (`shared/audit-diff.ts:9-30`) já lista `tokenHash`; um campo com nome diferente precisa ser acrescentado à mão — o comentário `:1-7` diz que a redação automática do log **não alcança** coluna JSONB persistida.
- `request-context.middleware.ts:36-62` normaliza segmento opaco de rota para `:token`, mas `:105-107` guarda o caminho **cru** quando ele difere do molde. Chave em **path** vaza no log; chave em **header** não.

### Rate limit e IP

- Global: 100/min (`app.module.ts:43`). A rota de intake tem `@Throttle({ limit: 30, ttl: 60000 })`. Um formulário público exposto ao browser tem perfil de abuso diferente de uma integração servidor-a-servidor.
- A chave do balde é `req.ip`, que depende de `trust proxy` (`main.ts:51-59`, `TRUST_PROXY_HOPS` default 1).

### Testes

- `apps/api/CLAUDE.md` é explícito: rota `@Public()` nova entra num e2e **no mesmo PR**, e rota pública que escreve em tabela com RLS precisa afirmar que **a linha está no banco** depois da chamada — sem contexto o RLS não estoura, grava zero linha e a rota responde sucesso.
- Padrão do e2e: `criarAppDeTeste()` (sobe o `AppModule` real, neutraliza só o `ThrottlerGuard` no protótipo), `beforeEach(limparBanco)`, `clientAdmin()` (bypassa RLS) + `findFirstOrThrow` como asserção de existência, fixtures `criarOwner`/`criarColaborador`/`criarPapel`.
- **Variável de ambiente setada dentro do spec chega tarde:** `ConfigModule.forRoot()` roda no import do `AppModule`, antes de qualquer `beforeAll`. Hoje `LEAD_INTAKE_TOKEN` mora em `test/.env.test` e é **repetido literalmente** no spec. Chave no banco elimina essa fragilidade — é um ganho colateral real.
- `MailService`, `PrismaService`, `PrismaAdminService` e adapters de e-mail/Stripe têm spec que os instancia de verdade (mockar o adapter testa o mock).

### Arquitetura

- `LeadsModule` hoje não tem `domain/` nem `infra/` porque "não é dono de tabela nenhuma" (`leads.module.ts:8-16`). Com a chave de integração ele passa a ser — a subdivisão em camadas com token DI de repositório vira obrigatória (`apps/api/CLAUDE.md` → Repository pattern: a camada `application` depende de **interface** declarada em `domain/`, nunca do `PrismaService`).
- Módulo não acessa o interior de outro: comunicação só pelos services exportados no `*.module.ts`.

## Open Questions

1. **A "máquina de segredo-por-registro" nasce aqui ou espera a 19-B?** O `ROADMAP.md:595-604` e o `ENDPOINTS.md:1204` prometem, duas vezes, que geração/exibição única/mascaramento/rotação nascem na Fase 19 junto da API key com escopos — e a 17-A precisa dessa máquina para um escopo só (aceitar lead). Três caminhos: (a) chave de propósito único agora, e a 19-B generaliza depois; (b) antecipar a máquina genérica com escopos, absorvendo parte da 19-B; (c) manter o token de ambiente e entregar só as outras quatro frentes. **Decisão de produto, não técnica.**

2. **Onde o formulário público é servido?** É a pergunta que define o custo da frente 2. (a) Rota pública do `apps/web` (`/captacao/:slug`) — mesma origem, **zero** mudança de CORS/CSP, é a variante gratuita; (b) embutido no site do owner via iframe — exige derrubar `X-Frame-Options: DENY` e `frame-ancestors 'none'`; (c) snippet JS que faz `fetch` cross-origin — exige abrir CORS na rota de intake. O ROADMAP diz "formulário público de captação (site, landing page)" sem desambiguar.

3. **Como a `origem: string` do payload casa com o `LeadSourceCatalog`?** O comentário atual (`leads-intake.service.ts:131-133`) explica por que hoje é tag: *"`LeadSourceCatalog` é do owner e pode não ter um item correspondente. Tag preserva a atribuição sem inventar catálogo na conta de ninguém."* Opções: casar por nome com o `CatalogResolver` da 14-A e criar o item quando não existir; casar e cair em tag quando não bater; ou a chave de integração declarar **qual** fonte de lead ela alimenta (fixa por chave, sem heurística). Manter a tag em paralelo ou não também é decisão.

4. **Qual é a regra de roteamento?** O ROADMAP diz "roteamento do lead novo para um responsável" sem definir a política: responsável fixo por chave de integração (mais simples, determinístico, testável), round-robin entre membros, ou responsável do cadastro já existente no caso reincidente. Nota relevante: `record-scope.ts:10-11` diz que registro **sem** responsável é visível para quem só vê os próprios — então rotear **reduz** a visibilidade do lead, e a mesma linha cita explicitamente "o roteamento da Fase 17".

5. **O lead reincidente é re-roteado?** Hoje o caminho `atualizado` só empilha a nota (`:113-118`) e não toca em responsável, origem nem tags. Se o cadastro já tem responsável, mantê-lo é o óbvio; se não tem, atribuir agora é decisão.

6. **Quem é notificado quando o lead nasce com responsável?** Hoje `LEAD_RECEIVED` vai para o owner, com a justificativa "lead que acabou de chegar ainda não tem responsável a quem endereçar" (`:60-66`). Com roteamento isso muda: avisar só o responsável, os dois, ou manter o owner. E `RECORD_ASSIGNED` não serve — exige `AccessContext` no CLS, que a rota pública não tem.

7. **A geração/rotação da chave entra na auditoria?** É ação sensível de workspace. `AuditEntity` não tem valor para integração/chave (`CLIENT … IMPORT`) e o enum é do banco — acrescentar exige migration, como a 14-A fez com `IMPORT`. `AuditAction` tem `CRIAR`/`EXCLUIR`, mas não "rotacionar".

8. **Uma chave por owner ou N chaves nomeadas?** N (uma por origem: site, landing X, n8n) permite revogar uma sem derrubar as outras e casa com "qual fonte de lead esta chave alimenta" (questão 3). Uma só é mais simples. O `WebhookChannel` da Fase 9 optou por N destinos nomeados por usuário — precedente na casa.

9. **Como é o corte em produção sem perder lead?** O `site-v2` está em outro repositório e envia com o token de ambiente hoje. Aceitar as duas formas por uma janela, ou coordenar o deploy dos dois lados? E a chave nova é provisionada automaticamente para os owners existentes (migration) ou cada um gera a sua na tela?

10. **O formulário público exige captcha?** Turnstile já está integrado e o CSP já libera o domínio, mas `CaptchaService` não é exportado do `AuthModule`. Sem captcha, o teto de 30/min por IP é a única defesa de uma rota de escrita aberta ao browser.

11. **`docs/observabilidade.md` e `docs/deploy.md` entram no escopo?** Os seis eventos `lead.*` e as duas variáveis do intake nunca foram catalogados. A fase mexe exatamente nesses pontos — é a janela natural para acertar, mas é trabalho fora das cinco frentes.

## Code References Index

**Módulo leads (o que muda)**
- `apps/api/src/modules/leads/application/leads-intake.service.ts:53-90` — `receber`: resolve owner, grava, notifica pós-commit, loga
- `apps/api/src/modules/leads/application/leads-intake.service.ts:93-149` — `gravar`: dedup por telefone, `tags: [origem]`, cria `Client` + `Contact`
- `apps/api/src/modules/leads/application/leads-intake.service.ts:151-195` — `resolverOwner`: o método que sai daqui, com o caminho da fase escrito no docblock
- `apps/api/src/modules/leads/api/lead-intake-token.guard.ts:34-63` — token de instância, `timingSafeEqual` sobre sha256
- `apps/api/src/modules/leads/api/leads-intake.controller.ts:24-33` — `@Public()` + guard + `@Throttle(30/60s)` + `@HttpCode(200)`
- `apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:12-77` — contrato com o `site-v2`; nomes não se mexem
- `apps/api/src/modules/leads/application/nota-de-lead.ts:43-72` — `montarNotaDeLead` / `empilharNota` (funções puras)
- `apps/api/src/modules/leads/leads.module.ts:8-23` — hoje sem `domain/`/`infra/`

**Segredo por registro (o molde)**
- `apps/api/prisma/schema.prisma:77-90` — `CollaboratorInvite`: `tokenHash @unique`, `expiresAt`, `usedAt`
- `apps/api/src/modules/collaborators/application/invites.service.ts:67-75` — `randomBytes(32).toString('hex')`
- `apps/api/src/modules/collaborators/application/invites.service.ts:180-183` — `hash()`: sha256 determinístico, indexável
- `apps/api/src/modules/collaborators/application/invites.service.ts:156-172` — `findValidOrFail`: mesma mensagem 410 para inexistente/expirado/usado
- `apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts:13` — `PrismaAdminService` para tabela com RLS lida sem contexto
- `apps/api/src/modules/collaborators/infra/prisma-invite.repository.ts:17-31` — `replaceForUser`: apagar antes de criar = só o último vale
- `apps/api/src/modules/collaborators/application/invites.service.spec.ts:81-89` — asserção de que o valor cru não vaza
- `apps/api/prisma/schema.prisma:127-138` — por que `Session` usa argon2 e o convite usa sha256
- `apps/api/src/modules/notifications/application/notification-targets.service.ts:194-231` — `paraApi`/`resumirConfig`: mascaramento na resposta

**RLS e rota pública**
- `apps/api/src/prisma/prisma.service.ts:57-94` — `executarComoOwner` + as duas obrigações de quem chama
- `apps/api/src/prisma/prisma.service.ts:40-55` — `get db()`: `tx` do CLS ou `this.base`
- `apps/api/src/prisma/prisma-admin.service.ts:1-27` — client privilegiado (`DATABASE_URL`, bypassa RLS)
- `apps/api/src/prisma/owner-context.interceptor.ts:38-52` — early-return sem `req.user`/`req.access`
- `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:6-20` — policy `owner_isolation`, fail-closed
- `apps/api/prisma/migrations/20260805100000_lead_source_catalog/migration.sql:126-133` — molde de RLS de tabela nova
- `apps/api/test/rls.e2e-spec.ts:49` — meta-teste: tabela com `ownerId` sem RLS quebra o build

**Responsável**
- `apps/api/prisma/schema.prisma:206-225` — `Client.assigneeId`, `onDelete: SetNull`, `@@index([ownerId, assigneeId])`
- `apps/api/src/modules/workspace/application/workspace-members.service.ts:23-37` — `assertMember`
- `apps/api/src/modules/workspace/infra/prisma-workspace-member.repository.ts:9-21` — `membersOf`: quem é atribuível
- `apps/api/src/modules/clients/application/clients.service.ts:53-93` — `create`: `assertMember` + `RECORD_ASSIGNED`
- `apps/api/src/shared/record-scope.ts:10-11` — registro sem responsável é visível a todos; cita a Fase 17
- `apps/api/src/shared/assignee-changed.ts:1-17` — type guard de mudança de responsável
- `apps/api/src/modules/clients/api/dto/create-client.dto.ts:40-47` — `assigneeId?: string | null`
- `apps/web/src/lib/members-lookup.ts:12-58` — `useWorkspaceMembers`, `NO_ASSIGNEE`, `buildMemberItems`
- `apps/web/src/components/ui/assignee-select.tsx:21-47` — `AssigneeSelect`

**Catálogo de fontes de lead**
- `apps/api/prisma/schema.prisma:277-287` — `LeadSourceCatalog`
- `apps/api/prisma/schema.prisma:192-193` — `Client.sourceId` / `source`, `onDelete: Restrict`
- `apps/api/src/modules/catalogos/application/catalogos.service.ts:70-82` — `assertUtilizavel`
- `apps/api/src/modules/catalogos/infra/prisma-catalog.repository.ts:26-51` — registry `kind → delegate`
- `apps/api/src/shared/default-catalogs.ts:20-26` — as 5 fontes padrão de conta nova
- `apps/api/src/modules/data/application/catalog-resolver.ts:23` — resolvedor por nome, com inativos
- `apps/api/src/modules/data/application/import.service.ts:192-227` — decisão sobre origem desconhecida
- `apps/api/src/modules/clients/application/clients.service.ts:59-67` — `sourceId` validado no create
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:18-22` — `withAssignee`: `source` embutido
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:97-109` — `findByPhoneDigits`: `contains`, sem recorte

**Notificação**
- `apps/api/src/modules/notifications/notifications.service.ts:73-108` — `notificar`: exige CLS, descarta auto-atribuição
- `apps/api/src/modules/notifications/notifications.service.ts:110-136` — `notificarPeloSistema`
- `apps/api/src/modules/notifications/application/notification-content.ts:225-246` — render de `LEAD_RECEIVED`
- `apps/api/src/modules/notifications/application/notification-content.ts:155-168` — render de `RECORD_ASSIGNED`
- `apps/api/prisma/schema.prisma:735-747` — enum `NotificationType` (7 valores)

**Fronteira HTTP, env, segurança**
- `apps/api/src/main.ts:74-84` — `ValidationPipe` (whitelist + forbidNonWhitelisted) e CORS de origem única
- `apps/api/src/main.ts:51-59` — `trust proxy` (chave do rate limit)
- `apps/api/src/main.ts:64-72` — helmet, `hsts: false`
- `apps/api/src/app.module.ts:43` — throttler global 100/60s
- `apps/api/src/app.module.ts:83-91` — ordem dos guards + interceptor
- `apps/api/src/config/env.validation.ts:50-63` — as duas variáveis do intake
- `apps/api/src/modules/auth/captcha/captcha.service.ts:19-45` — Turnstile; `isEnabled()` desliga em dev
- `apps/api/src/modules/auth/auth.module.ts:26` — `CaptchaService` **não** exportado
- `apps/web/nginx.conf:66` — `X-Frame-Options: DENY`
- `apps/web/nginx.conf:74` — CSP com `frame-ancestors 'none'` e Turnstile liberado
- `apps/api/src/shared/logging/log.ts:24-29` — `CHAVE_SENSIVEL` (não cobre `chave`/`url`)
- `apps/api/src/shared/audit-diff.ts:9-30` — `CAMPOS_OMITIDOS`
- `apps/api/src/shared/logging/request-context.middleware.ts:36-62`, `:105-107` — `:token` na rota, caminho cru quando difere
- `apps/api/src/shared/permissions.ts:41-195` — catálogo; `Organização` é a categoria da chave nova
- `apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql:40-60` — backfill de permissão em papéis

**Testes**
- `apps/api/test/lead-intake.e2e-spec.ts:1-23` — por que este caminho tem e2e com banco de verdade
- `apps/api/test/lead-intake.e2e-spec.ts:70-97` — asserção "a linha está no banco" com `clientAdmin()` + `findFirstOrThrow`
- `apps/api/test/helpers/app.ts:21-40` — `criarAppDeTeste`
- `apps/api/test/helpers/fixtures.ts:4-16` — `criarOwner`
- `apps/api/test/.env.test:17-22` — por que a variável mora aqui e não no spec
- `apps/api/src/modules/leads/application/leads-intake.service.spec.ts:42-49` — ordem: notificação pós-commit

**Frontend**
- `apps/web/src/routes/router.tsx:58-93` — rotas públicas e o nó `ProtectedRoute` → `AppLayout`
- `apps/web/src/features/administracao/tabs.ts:16-55` — `ADMIN_TABS`, fonte única de nav + router
- `apps/web/src/features/organizacao/LinkConviteBox.tsx:1-59` — único padrão de clipboard + aviso de uso único
- `apps/web/src/features/auth/AceitarConvitePage.tsx:66-159` — página pública: 3 estados
- `apps/web/src/features/organizacao/ConvidarColaboradorDialog.tsx:30-215` — form completo (zod + RHF + Field)
- `apps/web/src/features/organizacao/api/organizacao.api.ts:47-58` — chamada sem sessão pelo mesmo `api`
- `apps/web/src/features/organizacao/api/hooks.ts:110-120` — query pública com `retry: false`
- `apps/web/src/lib/api.ts:5-64` — axios único, refresh automático, 402 → `/assinatura`
- `apps/web/src/features/catalogos/CatalogSelect.tsx:44-123` — cadastro/exclusão de item no próprio select
- `apps/web/src/features/catalogos/api/hooks.ts:16-21` — invalidação cruzada por `kind`
- `apps/web/src/lib/labels.ts:8-13` — as quatro listas do owner **não** vivem aqui
- `apps/web/src/hooks/use-can.ts` — `can`/`canAny`/`isOwner`/`loading`
- `apps/web/src/app/PermissionRoute.tsx:17-31` — não redireciona enquanto `loading`

**Documentação**
- `apps/api/ENDPOINTS.md:311-321` — bloco atual de `POST /leads/intake`
- `apps/api/ENDPOINTS.md:359-421` — seção Catálogos
- `apps/api/ENDPOINTS.md:1203-1207` — a URL do webhook é a credencial; HMAC fica para a Fase 19
- `ROADMAP.md:527-543` — Fase 17, os 6 itens e a justificativa
- `ROADMAP.md:576-604` — Fase 19-B: API key por owner, e a máquina de segredo
- `.env.example:102-108` — as duas variáveis e o `CRM_LEADS_TOKEN` do lado do site
- `apps/api/CLAUDE.md` — Repository pattern, log estruturado, e2e de rota pública, migration com dado dentro
