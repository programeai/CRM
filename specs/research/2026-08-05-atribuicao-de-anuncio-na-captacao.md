---
date: 2026-08-05T23:20:20-03:00
researcher: claude
git_commit: 6aa49438266e2e50d044ae8b56e37cd3204a57c7
branch: main
topic: "Capturar atribuição de anúncio na ingestão de lead (fbclid/fbc/fbp e utm_*) e persistir no Client"
tags: [research, leads, clients, prisma, lgpd, consent, account-export, meta-ads]
status: complete
---

# Research: Captura de atribuição de anúncio na ingestão de lead

## Research Question

Capturar atribuição de anúncio na ingestão de lead: `fbclid`/`fbc`/`fbp` e `utm_*` no `POST /leads/intake`, persistidos no `Client`, para permitir enviar conversão server-side ao Meta Ads quando a oportunidade for ganha (meses depois).

Escopo declarado: **apenas a captura e a persistência** da atribuição — não inclui o motor de regras, nem o envio da conversão, nem eventos novos de webhook.

## Summary

**Hoje não existe nada.** Grep case-insensitive por `fbclid|fbp|fbc|gclid|utm|tracking|attribution|referrer|pixel|Conversions API` em todo o repositório retorna zero ocorrências técnicas — só rótulos humanos ("tráfego pago" como item de catálogo de fonte de lead) e strings de seed. `model Client` (`apps/api/prisma/schema.prisma:292-335`) tem 20 colunas e nenhuma de campanha ou click id. `IntakeLeadDto` (`apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:31-111`) tem 13 campos, e como o `ValidationPipe` global roda com `forbidNonWhitelisted`, **um `utm_source` enviado hoje responde 400** — o lead é perdido, não ignorado. O mais próximo de atribuição que existe é semântico: `origem: string` vira `Client.tags[0]` (rótulo cru da origem) e `pagina?: string` sobrevive apenas como linha de texto dentro de `Client.notes`, montada por `montarNotaDeLead` (`apps/api/src/modules/leads/application/nota-de-lead.ts:51`). O campo `qualificacao` do DTO é aceito e **descartado** — não há sink de JSON de lead, apesar da impressão que o campo dá.

**A pesquisa externa contradiz a premissa temporal do pedido.** A Conversions API da Meta rejeita o request inteiro se qualquer `event_time` estiver mais de **7 dias** no passado; a janela máxima de atribuição a clique no Ads Manager é **7 dias** (28-day click e 7-day view não são mais suportados); e o programa Conversion Leads exige que a conversão ocorra em **≤28 dias** da geração do lead. O evento "cliente fechou hoje" é aceito (o `event_time` é *agora*), mas **não existe caminho documentado em que um `fbc` de meses atrás produza atribuição ao clique original**. Os 90 dias frequentemente citados são a expiração recomendada do *cookie* `_fbc`, não janela de atribuição — confundir os dois é o erro central desse assunto. Para comparação, o Google Ads aceita conversão offline até **90 dias** após o último clique (63 dias para enhanced conversions for leads), o que torna o `gclid` estruturalmente mais compatível com ciclo de venda de agência do que o `fbclid`. Isso **não invalida a captura** — ela continua sendo pré-requisito irrecuperável (o `creationTime` em ms do primeiro contato não pode ser reconstruído depois) e serve a relatório interno, ao Google Ads e a envio precoce de estágios intermediários do funil —, mas muda o que o produto pode prometer sobre Meta.

**Três bloqueios não-código, todos fora do módulo de leads.** (1) A Política de Privacidade afirma em três lugares que o produto não usa rastreadores publicitários (`apps/web/src/features/legal/PrivacidadePage.tsx:209-210`, `:261`, `:607`); persistir `fbclid`/`_fbp` a torna falsa, e a Fase 19-B registrou explicitamente que "a Q8 do PRD já está satisfeita; não há texto a corrigir" — este trabalho reabre isso. (2) O catálogo de finalidades de consentimento é fechado (`apps/api/src/modules/consent/domain/consent-purpose.ts:14-39`) e nenhuma das quatro cobre atribuição publicitária; enviar dado de lead à Meta é `compartilhamento_terceiro`, que por art. 7º § 5º exige consentimento **específico e separado** — e a ingestão de lead hoje **não grava nenhuma linha de `ConsentRecord`**. (3) O emissor dos leads (`site-v2`) **vive em outro repositório**: nenhum valor chega até ele passar a enviar, e a ordem de deploy é obrigatoriamente API primeiro / site depois, porque o inverso responde 400 e perde o lead.

## Codebase Map

### Affected Files & Modules

| File | Role | Relevance |
|------|------|-----------|
| `apps/api/prisma/schema.prisma:292-335` | `model Client` — 20 colunas, sem nada de atribuição | Destino da persistência. Sem comentários `///` hoje (é modelo do `init`); os modelos das fases 9/19 são documentados |
| `apps/api/prisma/migrations/` | 43 migrations; próxima seria `20260826100000_<nome>` | Coluna nullable em tabela com RLS **não** exige policy nem re-GRANT (evidência na seção Patterns) |
| `apps/api/prisma/fixtures/invariantes.sql` | 19 blocos `DO $$` | Invariante obrigatória só com backfill ou troca de constraint. Regra de coerência entre colunas novas usa o molde `:317-349` |
| `apps/api/prisma/fixtures/banco-populado.sql` | 2 owners, 2 clients, 7 stages, 3 deals | **Não tocar** — só colunas do `init`. As colunas novas rodarão contra 2 linhas de `Client` |
| `apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:31-111` | Contrato HTTP da ingestão | Campo novo é aditivo e seguro; `forbidNonWhitelisted` faz campo não declarado virar 400 |
| `apps/api/src/modules/leads/application/leads-intake.service.ts:142-245` | `gravar()` — dentro de `executarComoOwner` | Mapeamento DTO→Client. Caminho reincidente (`:184-192`) hoje só toca `notes` e `assigneeId` |
| `apps/api/src/modules/leads/application/nota-de-lead.ts:43-59` | `montarNotaDeLead` | Único lugar onde `pagina`/`recebidoEm` sobrevivem hoje (texto em `notes`) |
| `apps/api/src/modules/clients/application/clients.service.ts:63-116` | `create()` — a ingestão escreve por aqui, não por Prisma | Valida `assigneeId` e `sourceId`; `{ avisarResponsavel: false }` suprime notificação |
| `apps/api/src/modules/clients/infra/prisma-client.repository.ts:28-30` | `client.create` com `Prisma.ClientUncheckedCreateInput` | Aceita campo novo sem alteração |
| `apps/api/src/modules/clients/api/dto/create-client.dto.ts` · `update-client.dto.ts` | DTOs autenticados de cliente | `forbidNonWhitelisted` → 400 se o front mandar campo não declarado. Decisão: campo é read-only ou editável? |
| `apps/api/src/modules/account/domain/account-dump.ts:7` · `:99-122` | `VERSAO_DO_DUMP = 2` + `interface ClienteExportado` | Portabilidade. Coluna nova exige subir a versão para 3 (spec `account-export.service.spec.ts:133` amarra) |
| `apps/api/src/modules/account/infra/prisma-account-dump.repository.ts:123-149` · `:360-383` | `select` explícito + mapper | **Falha silenciosa**: coluna nova não aparece no arquivo de portabilidade se esquecida |
| `apps/api/src/modules/clients/application/client-export-columns.ts:16-36` | 19 colunas do CSV/XLSX | Falha silenciosa idem |
| `apps/api/src/modules/data/domain/import.ts:24-64` · `application/import-dto-builder.ts:27-58` | Catálogo de campos importáveis (2 listas literais) | Precedente `personType`: campo deliberadamente **fora** do import. Coluna de atribuição não precisa entrar |
| `apps/api/src/shared/audit-diff.ts:10-34` | `CAMPOS_OMITIDOS` (lista manual) | Campo novo **entra no `AuditLog.diff` por default**, retido 5 anos (`retention/domain/retencao.ts:42`) |
| `apps/api/src/modules/retention/infra/prisma-retention.repository.ts:94-118` | Faxina da lixeira | `Client` prende por tudo; lead com `Contact` principal **nunca** é expurgado pela lixeira |
| `apps/api/src/modules/account/infra/prisma-account-purge.repository.ts:90` | `tx.client.deleteMany(onde)` | Coluna nova é apagada automaticamente no expurgo — nada a fazer |
| `apps/api/src/modules/consent/domain/consent-purpose.ts:14-39` | 4 finalidades fechadas, `as const` | Nenhuma cobre atribuição publicitária. Finalidade fora do catálogo → 400 |
| `apps/api/ENDPOINTS.md:366-376` | Bloco de `POST /leads/intake`, **Body transcrito campo a campo** | Obrigatório no mesmo PR (`apps/api/CLAUDE.md` → Definition of Done) |
| `apps/web/src/features/clientes/api/types.ts:12-38` | `interface Client` — única declaração no front | Tipa leitura **e** escrita (`Partial<Client>` em `clients.api.ts:11-24`) |
| `apps/web/src/features/clientes/tabs/DadosTab.tsx:78-118` | Renderiza o `Client` campo a campo | Bloco novo entraria em `:99` (entre "Endereço" e "Tags"), com os primitivos locais `Section` (`:46-59`) e `Row` (`:7-39`) |
| `apps/web/src/features/ajuda/CaptacaoDocPage.tsx:28-153` · `:282-287` | Doc do contrato dentro do app | O próprio arquivo (`:16-24`) obriga atualização no mesmo PR. `:282-287` tem a contagem "São treze campos" **escrita à mão** |
| `apps/web/src/features/legal/PrivacidadePage.tsx:209-210, 261, 607` | Nega rastreadores publicitários em 3 lugares | Persistir `fbclid` torna a Política falsa |
| `apps/api/test/lead-intake.e2e-spec.ts` | e2e da rota pública | Rota `@Public()` que escreve em tabela com RLS: o e2e **precisa** afirmar a linha no banco |

Não afetados, apesar da aparência: `modules/webhooks` (escopo exclui evento novo), `modules/pipeline` (escopo exclui o gatilho de fechamento), `LeadIntakeChannel` e sua UI (`apps/web/src/features/integracoes/CanalDialog.tsx`) — a menos que a atribuição vire configuração por canal.

### Existing Patterns to Follow

**Pattern: migration de colunas nullable aditivas em tabela com RLS**

```sql
-- De apps/api/prisma/migrations/20260814100000_account_deletion/migration.sql (integral)
-- Fase 19-A: encerramento de conta agendado, com carência.
--
-- Colunas nulas e aditivas: nenhum backfill. O índice serve à varredura do
-- `AccountPurgeJob` (um `WHERE "deletionScheduledFor" <= now()` diário sobre
-- `User`), que sem ele seria seq scan.
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt"  TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletionScheduledFor" TIMESTAMP(3);

CREATE INDEX "User_deletionScheduledFor_idx" ON "User"("deletionScheduledFor");
```

**Why this matters**: é o estilo do projeto — cabeçalho em pt-BR declarando *nullable, sem backfill, e por que o índice existe*, um `ALTER TABLE` por linha. E é a prova de que **não há nada de RLS a fazer**: seis migrations posteriores ao `enable_rls` adicionaram coluna a tabela com RLS (`20260727100000_assignee_per_record:19-22` em `Client`/`Deal`/`Task`/`Activity`; `20260730100000_soft_delete_lixeira:15-18`; `20260805100000_lead_source_catalog:68` — `sourceId` em `Client`; `20260818100000_proposal_billing_plan:5-12`) e **nenhuma** emitiu policy, `GRANT` ou `ALTER … ROW LEVEL SECURITY` para a tabela existente. A policy é `FOR ALL` sobre a expressão `"ownerId" = current_setting('app.owner_id', true)`, sem enumerar colunas, e privilégio de tabela no Postgres cobre colunas futuras. A contagem-âncora de `pg_policies` em `apps/api/test/rls.e2e-spec.ts:82-92` (`toBe(27)`) sobe só com tabela nova, não com coluna nova.

**Pattern: campo opcional no DTO de ingestão**

```ts
// De apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:77-81
  /** Caminho da página que capturou ("/", "/agenda-cheia"). */
  @IsOptional()
  @IsString({ message: 'Página inválida.' })
  @MaxLength(200, { message: 'A página deve ter no máximo 200 caracteres.' })
  pagina?: string | null;
```

**Why this matters**: o docblock da classe (`:12-29`) fixa três regras que valem para todo campo novo — os nomes são o contrato com o `site-v2` e não se mexem; `null` é aceito porque a origem diferencia "não perguntamos" de "perguntamos e veio vazio"; e a `message` nasce em pt-BR, porque nesta rota ela é o único retorno que quem integra de fora tem.

**Pattern: as três superfícies silenciosas da portabilidade**

```ts
// apps/api/src/modules/account/infra/prisma-account-dump.repository.ts:123-149 (select)
db.client.findMany({ where: { ownerId }, select: { id: true, name: true, /* … 18 campos … */ } })

// :360-383 (mapper)
clientes: clientes.map((c) => ({ id: c.id, name: c.name, /* … */ }))

// apps/api/src/modules/account/domain/account-dump.ts:99-122 (tipo) e :7
export const VERSAO_DO_DUMP = 2; // ← 2 na Fase 19-B: entrou `consentimentos`
```

**Why this matters**: o dump usa `select` explícito, nunca `include` largo. Coluna nova **simplesmente não aparece** no arquivo de portabilidade até ser adicionada em três lugares — e só o tipo quebra a compilação; o `select` e o mapper falham calados. `VERSAO_DO_DUMP` sobe "quando uma coleção é adicionada, removida ou troca de forma", e o spec `account-export.service.spec.ts:133` amarra o valor.

**Pattern: invariante de coerência entre colunas novas nullable**

```sql
-- De apps/api/prisma/fixtures/invariantes.sql:317-349 (recortado)
-- As colunas nascem nulas e a migration é aditiva, então não há backfill a
-- conferir. O que se afirma aqui é a REGRA do par, que nenhuma constraint do
-- banco expressa: os dois campos andam juntos […]
DO $$
DECLARE meio_par INT;
BEGIN
  SELECT count(*) INTO meio_par FROM "User"
   WHERE ("deletionRequestedAt" IS NULL) <> ("deletionScheduledFor" IS NULL);
  IF meio_par > 0 THEN
    RAISE EXCEPTION 'Há % usuário(s) com encerramento meio-preenchido (um campo nulo e o outro não).', meio_par;
  END IF;
END $$;
```

**Why this matters**: é exatamente a forma do caso `fbclid` + `creationTime`, que **só valem em par** (um `fbclid` sem o timestamp não monta um `fbc`). A regra de `apps/api/CLAUDE.md:138-141` exige invariante para backfill ou troca de constraint — este caso é nenhum dos dois, mas há precedente de invariante acrescentada por regra de conjunto: `account_deletion` (par), `proposal_billing_plan` (`:394-400`, coerência por regime), `retention_indexes` (`:575-580`, existência de índice).

**Pattern: rótulo pt-BR de campo não-enum no front**

```tsx
// apps/web/src/features/clientes/tabs/DadosTab.tsx:83
<Row label="Origem" value={client.source?.name} />
```

**Why this matters**: `lib/labels.ts` traduz **enums** (`make(MAP)` com fallback para o próprio valor); não há hoje nenhum caso de "nome de campo → rótulo". Valor de `utm_source` é texto livre, não enum, então `make()` não serve — o que se traduziria é a chave. O precedente para chave com dois consumidores (tela do cliente **e** página de ajuda) é um `Record` irmão no molde de `NOTIFICATION_TYPE_DESCRIPTIONS` (`apps/web/src/lib/labels.ts:203-225`), que existe justamente porque é lido em dois lugares.

### Data Flow

```
POST /api/v1/leads/intake
  ThrottlerGuard (30/min por IP) → JwtAuthGuard (curto-circuitado por @Public())
  → LeadIntakeKeyGuard                     lead-intake-key.guard.ts:30-49
      Authorization: Bearer crm_…  →  IntegrationKeysService.autenticar(valor, 'lead:receber')
      sha256 indexado; revogada → 401; sem escopo → 403
      req[INTAKE_CONTEXT] = { ownerId, keyId }        ← só isso; keyName é descartado
  → LeadsIntakeController.receber          leads-intake.controller.ts:33-38
  → LeadsIntakeService.receber             leads-intake.service.ts:72-139
      └─ prisma.executarComoOwner(ownerId, gravar)    ← BEGIN + set_config('app.owner_id')
           IntegrationKeysService.registrarUso
           LeadIntakeChannelsService.findByKeyId(keyId)   → canal { assigneeId, sourceId, name }
           resolverResponsavel (WorkspaceMembersService.ehMembro)
           montarNotaDeLead(origem, pagina, recebidoEm, cenario, resumo, mensagem, email, cidade)
           ClientsService.findByPhoneDigits(ownerId, whatsapp)   ← dedupe, `contains`, mais recente ganha
             ├─ existe   → ClientsService.update: SÓ { notes, assigneeId? }   :184-192
             └─ não      → ClientsService.create + ContactsService.create      :209-237
         COMMIT
      NotificationsService.notificarPeloSistema  (LEAD_RECEIVED)      ← pós-commit
      OwnerWebhooksEmitterService.emitirPeloSistema (lead.recebido)   ← pós-commit
      logger.log({ evento: 'lead.ingerido' | 'lead.reingerido' })
```

Onde a atribuição entraria: campos novos no DTO, propagados em `gravar()` para `ClientsService.create` (`:209-230`). O caminho reincidente (`:184-192`) é a decisão de produto mais delicada — ver Open Questions.

Zero I/O de rede dentro de `executarComoOwner` (timeout de 5s do Prisma) é regra do projeto; notificação e webhook ficam deliberadamente fora da transação.

## External Research

### Documentation

**`fbc` — formato e o que precisa ser persistido.** [ClickID and the fbp and fbc Parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc):

```
fb.subdomainIndex.creationTime.fbclid
ex.: fb.1.1554763741205.IwAR2F4-dbP0l7Mn1IawQQGCINEz7PYXQvwjNwB_qa2ofrHyiLjcbCRxTDMgk
```

- `subdomainIndex`: "If you're generating this field on a server, and not saving an `_fbc` cookie, use the value 1."
- `creationTime`: Unix em **milissegundos**; server-side, "use the timestamp when you first observed or received this `fbclid` value".
- `fbclid`: **case-sensitive** — "do not apply any modifications before using, such as lower or upper case."
- Sem Pixel também funciona: "it is still possible to send the `fbc` event parameter […] if an `fbclid` query parameter is in the URL of the current page request."
- `fbc` **não é hasheado**. Expiração recomendada do cookie `_fbc`: 90 dias.

**Consequência de modelagem:** o CRM precisa guardar `fbclid` cru **e** o timestamp em ms do primeiro contato (ou o `fbc` já montado). O `creationTime` não é reconstruível depois — é o dado irrecuperável se não for capturado hoje.

**`fbp`.** `fb.subdomainIndex.creationTime.randomnumber` (ex.: `fb.1.1596403881668.1116446470`), gerado pelo **Pixel no browser**. O último componente é aleatório do cliente; um `_fbp` fabricado no servidor não corresponde a identificador que a Meta já viu (a doc descreve o formato para geração server-side mas não afirma que serve — **não confirmado** que sirva; a inferência é que não). Expiração do `_fbp`: **não declarada** na doc.

**Limites temporais — o achado que reposiciona o pedido.**

| Limite | Valor | Fonte |
|---|---|---|
| Idade máxima de `event_time` na CAPI | **7 dias** — "If any `event_time` in `data` is greater than 7 days in the past, we return an error for the entire request and process no events." | [Using the API](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/) · [Server Event Parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/) |
| Janela de atribuição a clique (Ads Manager) | **7 dias** (máximo atual; 28-day click, 28-day view e 7-day view não são mais suportados) | [Changes to attribution settings](https://en-gb.facebook.com/business/help/395050428485124) |
| Conversion Leads: conversão após o lead | **≤28 dias** — "Conversion event occurs within 28 days of lead generation" | [Conversion Leads Integration](https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration/) |
| Backfill do Conversions API for CRM | **7 dias** | idem |
| Loja física (`physical_store`) | 62 dias para upload da transação — mas a mesma página repete o limite de 7 dias de `event_time` sem resolver o conflito (**não confirmado**) | [Offline Events](https://developers.facebook.com/docs/marketing-api/conversions-api/offline-events/) |
| Google Ads — conversão offline por `gclid` | **90 dias** ("uploaded more than 90 days after the associated last click won't be imported"); 63 dias para enhanced conversions for leads; retenção do GCLID 90 dias | [Guidelines for importing offline conversions](https://support.google.com/google-ads/answer/15081888) · [Set up offline conversions using GCLID](https://support.google.com/google-ads/answer/7012522) |

**Não confirmado:** não há declaração oficial da Meta sobre "validade do `fbclid` como chave de matching" separada da janela de atribuição. Os 90 dias do `_fbc` são expiração de cookie, não janela.

**`user_data` e hashing.** [Customer Information Parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters) — só SHA-256. Exigem hash: `em` (trim + minúsculo), `ph` (**com código do país, sem `+`, sem símbolos, sem zeros à esquerda** → BR `5511987654321`), `fn`/`ln`, `db` (`YYYYMMDD`), `ge`, `ct` (minúsculo sem espaços: `saopaulo`), `st`, `zp`, `country` (ISO alpha-2 minúsculo: `br`). **Nunca hashear**: `fbc`, `fbp`, `lead_id`, `client_ip_address`, `client_user_agent`, `external_id`, `subscription_id`. Mínimo: pelo menos um parâmetro de cliente formatado corretamente — mas só geo + user agent (`ct`+`country`+`st`+`zp`+`ge`+`client_user_agent`) é explicitamente **inválido**.

**Hierarquia de identificadores.** Documentada **apenas** no contexto Lead Ads ([Conversion Leads Payload Specification](https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration/payload-specification/)): `lead_id` **Highest** · `fbc` **Highest** · e-mail hasheado **Highest** · telefone hasheado **High** · outros contatos hasheados **Medium**. `fbp` **não aparece** na tabela. Não existe hierarquia geral publicada fora desse contexto (**não confirmado**).

**Caminho atual para "fechou no CRM" (2026).** Conversions API for CRM / Conversion Leads, com **`action_source: "system_generated"`** — não `"other"`. Exige `user_data`, `event_name`, `event_time`, `action_source`, `lead_event_source`, `event_source`, e "Make sure to send **all stages** of leads as they are updated" (não só o fechamento). `lead_id` é o número de 15-17 dígitos vindo do webhook `leadgen_id` do Lead Ads — só existe se o lead veio de Instant Form dentro do Facebook/Instagram; landing page própria não tem, e sobra matching por `fbc` + contato hasheado. A Offline Conversions API é chamada de "legacy" na própria doc (aviso formal de depreciação: **não confirmado**). Pré-requisitos do Conversion Leads: ≥200 leads/mês, upload diário, taxa de conversão entre 1% e 40%, 3-4 semanas de learning phase.

**`event_id` e dedupe.** Opcional mas recomendado; a dedupe exige `event_name` idêntico **+** `event_id` idêntico, janela de 48h (evento de browser em até 5 min é o favorecido). Alternativa sem `event_id`: `external_id` + `fbp`. Para eventos offline o mecanismo é `dataset_id` + `event_time` + `event_name` + `item_number` + `order_id`.

**UTMs não servem para atribuição na Meta.** A referência de parâmetros da CAPI não tem nenhum campo UTM, nem em `user_data` nem como parâmetro de servidor; a página de Best Practices não menciona UTM; e a ferramenta Facebook Attribution — único lugar onde UTMs alimentavam atribuição da Meta — foi [descontinuada em 2021](https://www.facebook.com/business/help/126244809394867). UTMs seguem suportados apenas como [parâmetros de URL para ferramentas de terceiros](https://www.facebook.com/business/help/1016122818401732). **Não confirmado** por frase literal da Meta dizendo "UTMs não são usados para atribuição" — é inferência forte a partir da ausência total na especificação. Valor real dos UTMs aqui: relatório interno do owner, não atribuição na plataforma.

**Consentimento.** [Meta Pixel — GDPR](https://developers.facebook.com/docs/meta-pixel/implementation/gdpr) exige banner com consentimento afirmativo e `fbq('consent','revoke')` antes do init. **Não confirmado** que a doc estenda explicitamente esse requisito à CAPI server-side — a obrigação vem da LGPD/GDPR em si, não de cláusula da Meta. **Limited Data Use (LDU) não se aplica ao Brasil**: [Data Processing Options](https://developers.facebook.com/docs/marketing-api/overview/data-processing-options/) lista escopo exclusivamente de estados dos EUA ("available only for people in California, Colorado, …"), e não existe equivalente para LGPD ou GDPR. Não há flag de API que resolva conformidade — ela se resolve no consentimento do site e na governança do CRM.

### Reference Implementations

Nenhuma no repositório — é campo verde (grep confirmado em `apps/`, `specs/` e `ROADMAP.md`). O emissor `site-v2/src/lib/entrega-lead.ts` (tipo `PayloadLead`), citado como contrato no DTO, **não existe neste monorepo**: `pnpm-workspace.yaml` tem só `apps/*`, e `apps/` tem só `api` e `web`. Confirmado também por `specs/research/2026-07-28-fase-17a-entrada-de-lead.md:245` — "O contrato com o emissor não está documentado em lugar nenhum além do DTO. […] O site vive fora deste repositório."

### Libraries & Dependencies

**Nenhuma dependência nova é necessária para a captura.** SHA-256 sai de `node:crypto` (já usado em `integration-keys.service.ts` para `keyHash`), e cifra simétrica, se necessária, tem o precedente pronto em `apps/api/src/shared/crypto/segredo-cifrado.ts` (AES-256-GCM com `keyVersion`, usado pelo `UserTotp`). Cliente HTTP de saída também já existe (`apps/api/src/shared/webhook-post.ts`) — mas envio está fora deste escopo.

## Historical Context

**Fase 17-A — entrada de lead** (`specs/research/2026-07-28-fase-17a-entrada-de-lead.md`, `specs/plans/2026-07-28-fase-17a-entrada-de-lead.md`, `status: implemented`). Quatro decisões que restringem este trabalho:

- **Os nomes do DTO não se mexem** — "mudar um nome aqui quebra a captação em produção sem quebrar nenhum teste" (`research:42`, `:272`; `plan:48` põe isso em *What We're NOT Doing*). Acrescentar é aditivo e seguro; remover ou renomear, não (`research:273`).
- **Tag e `sourceId` coexistem, e não é redundância** (`plan:1531-1538`): "`origem` é o rótulo cru de quem capturou […] e distingue duas entregas do MESMO canal; `sourceId` é a classificação do owner, que alimenta relatório. Perder a tag apagaria a granularidade que a captação manda de graça." A fonte de lead vem **do canal**, nunca do payload (`plan:33`).
- **Lead reincidente não reescreve atribuição** (`plan:1500-1507`): "Origem, tags e fonte do cadastro existente também ficam como estão: elas contam de onde ele veio na **PRIMEIRA** vez, e reescrever isso apagaria histórico." Corolário no e2e: `expect(cliente.tags).toEqual(['site-institucional']); // a tag permanece` (`plan:1646`).
- **Formulário público saiu do escopo** por decisão de produto (`plan:19`, `:43`; issue #27, `ROADMAP.md:133`): o lead entra apenas servidor-a-servidor. `qualificacao` é o precedente de JSON livre no contrato, justificado por "o formato é da origem […] quem lê é humano" — e é aceito e descartado.

Grep registrado no próprio PRD da 17-A: zero ocorrências de `Meta Ads`/`Google Ads` em `specs/**` (`research:214`).

**Fase 19-A — LGPD mínimo** (`status: implemented`). Fixou o **papel duplo**: o CRM é *controlador* dos dados da conta do owner e *operador* dos dados de clientes/contatos cadastrados, cujos titulares são terceiros (`research:252-277`). Consequências registradas: reter dado de terceiro para finalidade própria é tratar fora das instruções, e o art. 42 § 1º I equipara o operador ao controlador (`:265-269`); titular-terceiro não pede exclusão ao CRM (art. 18 § 4º I — indicar o controlador). Também fixou que **prazo não é decisão de instância** (constantes exportadas, sem variável de ambiente) e que rotas de LGPD são isentas do `BillingGuard`.

**Fase 19-B — plataforma aberta** (`status: implemented`). Três coisas relevantes:

- **Catálogo de eventos de webhook é contrato público, "só acrescente"** (`plan:1238-1246`) — importa quando o envio de conversão for planejado, fora deste escopo.
- **Catálogo de finalidades de consentimento é fechado e fundamentado linha a linha** (`plan:2189-2228`): "Uma linha de `ConsentRecord` por finalidade — art. 8º § 4º […] Um 'aceito tudo' agregado seria nulo por lei". As quatro chaves: `comunicacao_marketing`, `comunicacao_whatsapp`, `compartilhamento_terceiro` ("Art. 7º § 5º exige consentimento **ESPECÍFICO e separado**"), `retencao_pos_contrato`. `ConsentRecord` é append-only **no banco** (`GRANT SELECT, INSERT` + `REVOKE UPDATE, DELETE`), com invariante que quebra o portão se o privilégio voltar. Revogação é linha nova, nunca `UPDATE`. `textVersion` vem do catálogo, nunca do corpo.
- **"O CRM registra, não comunica"** (`plan:53`): "Nenhum e-mail ou WhatsApp sai para `Client`/`Contact`. […] O CRM é o livro-razão que o owner consulta antes de comunicar por fora — **decisão explícita, não omissão**." E `plan:33` cita a Política verbatim para concluir que "a Q8 do PRD já está satisfeita; não há texto a corrigir" — este trabalho é o que reabre essa questão.

**Fase 16 — Automações e templates** (`ROADMAP.md:272-283`, ⬜ P2) é o slot do gatilho: "Regras 'quando X, então Y' configuráveis pelo owner". O comentário de `apps/api/src/modules/webhooks/application/owner-webhooks-emitter.service.ts:37-39` registra que o event bus foi deliberadamente evitado porque "o motor de regras é a Fase 16". WhatsApp e a integração externa são 17-C (`ROADMAP.md:285-302`), cuja nota é "o valor está em registrar, não em disparar".

**Git.** HEAD `6aa4943` (branch `main`). O módulo de leads tem 7 commits (`e5ee91a` cria a rota antes de qualquer spec; `2171053` é a 17-A; `73f798b` injeta o emitter de webhook; `3ff2ca1` remove o token legado de ambiente). A última migration é `719aeeb` → `20260825100000_retention_indexes`. Nada nos últimos 30 commits toca atribuição.

## Constraints & Considerations

**Ordem de deploy é obrigatória e assimétrica.** API primeiro, `site-v2` depois. Se o site começar a enviar `utm_source` antes do deploy da API, `forbidNonWhitelisted` responde 400 e **o lead é perdido** — comportamento documentado como intencional em `CaptacaoDocPage.tsx:295-302`. O inverso é inofensivo: campos opcionais simplesmente vêm vazios.

**Nada chega sem mudança em repositório externo.** A captura no CRM é condição necessária e insuficiente. Enquanto o `site-v2` não capturar `fbclid` da URL e o `_fbp` do cookie e enviá-los, todas as colunas ficam nulas.

**A Política de Privacidade fica falsa.** Três afirmações precisam ser reconciliadas (`PrivacidadePage.tsx:209-210` "não usamos ferramentas de análise comportamental, rastreadores publicitários ou perfis de marketing"; `:261` "não os cedemos para fins publicitários"; `:607` no resumo). O arquivo declara em `:21-24` que os números precisam bater com as constantes do código — "mudar um prazo no código sem mudar aqui torna esta Política falsa"; o mesmo raciocínio se aplica a categoria de dado. Note que a Política trata todo o conteúdo do CRM como "conteúdo do CRM" sob papel de operador (`:152-156`) e não enumera campo por campo — o que pode ou não bastar, dependendo da leitura jurídica.

**Nenhuma finalidade de consentimento cobre isto, e a ingestão não registra consentimento nenhum.** `POST /leads/intake` não grava linha de `ConsentRecord` (grep: zero em `modules/leads`), e a única porta de escrita de consentimento é `POST /consentimentos`, autenticada com JWT — inalcançável pela rota pública. Enviar dado de lead à Meta é `compartilhamento_terceiro`, que exige consentimento específico e separado (art. 7º § 5º). Registrar consentimento de fato pertence a quem exibe o formulário — o `site-v2` —, o que é uma decisão de arquitetura fora deste repositório.

**O dado novo entra no `AuditLog.diff` por default e fica 5 anos.** `CAMPOS_OMITIDOS` (`apps/api/src/shared/audit-diff.ts:10-34`) é lista **manual**, e hoje omite `document` justamente como "dado pessoal que a trilha não precisa repetir". `RETENCAO_AUDITORIA_DIAS = 5 * 365` (`retention/domain/retencao.ts:42`) contra "enquanto a conta existir" do `Client` — um identificador publicitário sobreviveria ao próprio cliente na trilha. Decisão a tomar explicitamente.

**Lead com `Contact` principal nunca sai pela faxina da lixeira.** `prisma-retention.repository.ts:94-118`: `Client` prende por todos os filhos (FKs RESTRICT), e a ingestão sempre cria um contato principal — então o lead vira `pulados.clientes` e é logado como `retencao.registro_pulado`. O expurgo de conta (`prisma-account-purge.repository.ts:90`) apaga por `deleteMany`, sem tocar em campo, então a coluna nova é coberta automaticamente ali.

**Quatro superfícies falham em silêncio se esquecidas**: `select` do dump (`prisma-account-dump.repository.ts:123-149`), mapper do dump (`:360-383`), colunas do CSV (`client-export-columns.ts:16-36`) e os dois catálogos de import (`data/domain/import.ts:24-64`, `import-dto-builder.ts:27-58`). Só o tipo `ClienteExportado` quebra a compilação. `VERSAO_DO_DUMP` precisa ir a 3 e o spec `account-export.service.spec.ts:133` amarra o valor.

**Nada de I/O de rede dentro de `executarComoOwner`** — timeout de 5s do Prisma. Vale para qualquer validação ou enriquecimento que se pense em fazer na captura.

**Log estruturado.** `CHAVE_SENSIVEL` (`apps/api/src/shared/logging/log.ts:28-29`) redige `token|secret|api[-_]?key|authorization|…` mas **não** cobre `fbclid`, `fbp`, `utm` nem `url`; `msg` nunca é redigida; a linha vive 30 dias num Grafana publicado na internet. Identificador publicitário não pode entrar em log.

**Migration.** Colunas nullable aditivas: sem RLS a fazer, sem `GRANT`, sem tocar `banco-populado.sql` (só colunas do `init`). Invariante não é obrigatória pela letra de `apps/api/CLAUDE.md:138-141` (sem backfill, sem troca de constraint), mas o par `fbclid`+`creationTime` é exatamente o caso de "regra de conjunto que nenhuma constraint expressa" que os precedentes cobrem. Portão local antes do PR:
`DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh`

**Testes.** `leads-intake.service.spec.ts` instancia a classe com `new` e 8 mocks na ordem do construtor (`:95-104`), sem `Test.createTestingModule`; o `PrismaService` fake empurra `'commit'` num array `ordem` para provar sequência pós-commit (`:66-74`). A rota é `@Public()` e escreve em tabela com RLS, então por `apps/api/CLAUDE.md:114-118` o e2e **precisa afirmar a linha no banco** depois da chamada — sem `app.owner_id` o RLS não estoura, grava zero linha e a rota responde sucesso.

**Doc obrigatória no mesmo PR**: `apps/api/ENDPOINTS.md:366-376` (Body transcrito campo a campo) e `apps/web/src/features/ajuda/CaptacaoDocPage.tsx` — `CURL` (`:28-35`), `CORPO_MINIMO` (`:37-41`), `CORPO_COMPLETO` (`:43-56`), tabela `CAMPOS` (`:73-153`) e a contagem **escrita à mão** "São treze campos" (`:282-287`), que envelhece calada. `docs/uso/` não enumera campos e não precisa mudar.

**Front.** `apps/web/src/features/clientes/api/types.ts:12-38` é a única declaração de `Client` e tipa leitura **e** escrita (`Partial<Client>`); `DadosTab.tsx` recebe o cliente por `useOutletContext` (`:62`), então bloco novo não precisa de query nova.

## Open Questions

1. **A premissa temporal do pedido não se sustenta na Meta — o escopo muda?** Os limites são 7 dias (`event_time`), 7 dias (janela de clique) e 28 dias (Conversion Leads). "Fechou meses depois" não tem caminho documentado de atribuição na Meta. Três leituras possíveis, e a escolha muda o desenho: (a) capturar de todo modo, porque o dado é irrecuperável e serve a relatório interno; (b) redirecionar o alvo para **Google Ads**, que aceita 90 dias e torna `gclid` o campo mais valioso do conjunto; (c) mudar o gatilho de "ganhou" para um estágio intermediário do funil que caiba nos 7-28 dias — o que é exatamente o que o Conversions API for CRM recomenda ("send all stages of leads as they are updated"). **Precisa de decisão antes do `/spec`.**

2. **Como reconciliar a Política de Privacidade?** Ela nega rastreadores publicitários em três lugares. Editar o texto, ou desenhar a captura de modo que a afirmação continue verdadeira (o CRM é operador armazenando o que o owner-controlador coletou, e não é o CRM que rastreia)? A segunda leitura é defensável mas precisa de decisão explícita, não de silêncio — e a 19-B já registrou que não havia texto a corrigir.

3. **Consentimento: quinta finalidade no catálogo, ou fora de escopo?** O catálogo é fechado e cada entrada é fundamentada em artigo da LGPD. `compartilhamento_terceiro` já existe e pode cobrir o envio à Meta — mas quem registra o consentimento é quem exibe o formulário, e a ingestão não tem porta de consentimento nenhuma. Opções: acrescentar campo de consentimento ao DTO de intake (aditivo, e faz o `site-v2` responsável por coletar); usar `compartilhamento_terceiro` via `POST /consentimentos` autenticado (o owner registra à mão); ou declarar fora de escopo com a dívida registrada.

4. **Modelagem: colunas, `Json` ou tabela filha?** Os três padrões do schema têm critério claro nos comentários (`String[]` para chaves de catálogo nosso; `Json` para shape que não é nosso e é lido em bloco; tabela filha quando cada item tem ciclo de vida/ordem/índice). Atribuição é conjunto fixo de campos escalares, conhecido, e potencialmente filtrável em relatório — o que aponta para colunas. Mas o precedente `qualificacao` mostra que o projeto já aceitou JSON livre vindo da origem. Quantas colunas exatamente: `fbclid` + `fbclidAt` (ms, obrigatório para montar `fbc`), `fbp`, `gclid`, `utmSource/Medium/Campaign/Content/Term`, `landingUrl` (o `event_source_url` da CAPI — hoje só `pagina`, que é caminho e vive na nota), `metaLeadId`? E `client_ip_address`/`client_user_agent`, que a CAPI valoriza e o projeto hoje deliberadamente **não** guarda de lead (a 19-A decidiu não registrar IP além do evento de autenticação)?

5. **Lead reincidente: sobrescreve a atribuição ou preserva a primeira?** A 17-A decidiu que "elas contam de onde ele veio na PRIMEIRA vez, e reescrever isso apagaria histórico", e o e2e amarra isso para tags. Para atribuição de anúncio o argumento inverso é forte: o clique que gerou o retorno é o mais recente, e é ele que precisa da conversão. Manter a primeira, sobrescrever, ou guardar as duas (primeiro e último toque)? A decisão muda o schema.

6. **O campo entra no `AuditLog.diff`?** Por default sim, retido 5 anos, contra "enquanto a conta existir" do `Client`. Acrescentar as colunas novas a `CAMPOS_OMITIDOS` (`shared/audit-diff.ts:10-34`), como `document` já está, ou aceitar a trilha?

7. **O campo é read-only na interface ou editável?** Se editável, entra em `create-client.dto.ts`/`update-client.dto.ts` e no `ClientFormDialog`; se read-only, só no `DadosTab` e no tipo do front. Read-only é coerente com "atribuição é fato da captação, não campo de cadastro" — mas impede correção manual.

8. **Entra na API pública (`POST /public/clients`) e no import?** Precedente `personType` mostra que campo deliberadamente fora do import é aceitável e documentado. A API pública tem política declarada de "campo novo é aditivo" (`ApiDocPage.tsx:546-551`), então incluir exige atualizar `docs/integracoes.md:145-153` e `ApiDocPage.tsx:104-122`.

## Code References Index

- `apps/api/prisma/schema.prisma:292-335` — `model Client`, 20 colunas, nenhuma de atribuição
- `apps/api/prisma/schema.prisma:176-201` — `model LeadIntakeChannel` (canal → assignee + source + key)
- `apps/api/prisma/schema.prisma:1263-1297` — `model ConsentRecord`, append-only
- `apps/api/prisma/migrations/20260814100000_account_deletion/migration.sql` — molde de colunas nullable aditivas
- `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql:14-20` — policy `owner_isolation` de `Client`
- `apps/api/prisma/migrations/20260727100000_assignee_per_record/migration.sql:19-22` — coluna nova em tabela com RLS, sem policy nova
- `apps/api/prisma/fixtures/invariantes.sql:317-349` — molde de invariante de par de colunas nullable
- `apps/api/prisma/fixtures/banco-populado.sql:36-38` — os 2 clientes contra os quais a migration roda
- `apps/api/scripts/validar-migrations-com-dados.sh` — portão de migration com dado dentro
- `apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:12-29` — docblock do contrato com o `site-v2`
- `apps/api/src/modules/leads/api/dto/intake-lead.dto.ts:77-81` — molde de campo opcional
- `apps/api/src/modules/leads/api/lead-intake-key.guard.ts:30-49` — autenticação por chave
- `apps/api/src/modules/leads/api/intake-context.ts:13-20` — `{ ownerId, keyId }`, só isso
- `apps/api/src/modules/leads/application/leads-intake.service.ts:142-245` — `gravar()`
- `apps/api/src/modules/leads/application/leads-intake.service.ts:184-192` — caminho reincidente (só `notes` + `assigneeId`)
- `apps/api/src/modules/leads/application/leads-intake.service.ts:209-230` — criação do `Client`
- `apps/api/src/modules/leads/application/nota-de-lead.ts:43-59` — `montarNotaDeLead`, único destino de `pagina`
- `apps/api/src/modules/clients/application/clients.service.ts:63-116` — `create()` com validação de assignee/source
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:28-30` — `client.create`
- `apps/api/src/modules/clients/application/client-export-columns.ts:16-36` — 19 colunas do CSV
- `apps/api/src/modules/account/domain/account-dump.ts:7` — `VERSAO_DO_DUMP = 2`
- `apps/api/src/modules/account/domain/account-dump.ts:99-122` — `interface ClienteExportado`
- `apps/api/src/modules/account/infra/prisma-account-dump.repository.ts:123-149` — `select` do `Client`
- `apps/api/src/modules/account/infra/prisma-account-dump.repository.ts:360-383` — mapper do `Client`
- `apps/api/src/modules/account/infra/prisma-account-purge.repository.ts:90` — `client.deleteMany` no expurgo
- `apps/api/src/modules/consent/domain/consent-purpose.ts:14-39` — 4 finalidades fechadas
- `apps/api/src/modules/data/domain/import.ts:24-64` — campos importáveis de cliente
- `apps/api/src/modules/data/application/import-dto-builder.ts:27-58` — 17 campos explícitos
- `apps/api/src/modules/retention/domain/retencao.ts:26-42` — 180 / 90 / 1825 dias
- `apps/api/src/modules/retention/infra/prisma-retention.repository.ts:94-118` — `Client` prende por tudo
- `apps/api/src/modules/webhooks/domain/owner-webhook-event.ts:13-55` — catálogo público, 8 eventos, sem `negociacao.ganha`
- `apps/api/src/modules/webhooks/application/owner-webhooks-emitter.service.ts:37-39` — "o motor de regras é a Fase 16"
- `apps/api/src/prisma/prisma.service.ts:75-94` — `executarComoOwner` (`set_config('app.owner_id')`)
- `apps/api/src/shared/audit-diff.ts:10-34` — `CAMPOS_OMITIDOS`, lista manual
- `apps/api/src/shared/logging/log.ts:28-29` — `CHAVE_SENSIVEL` não cobre `fbclid`/`utm`/`url`
- `apps/api/src/shared/crypto/segredo-cifrado.ts` — AES-256-GCM com `keyVersion` (precedente de cifra)
- `apps/api/test/lead-intake.e2e-spec.ts:124-232` — e2e da rota pública, verificação por `clientAdmin()`
- `apps/api/test/rls.e2e-spec.ts:82-92` — contagem-âncora de 27 policies (sobe só com tabela nova)
- `apps/api/ENDPOINTS.md:366-376` — bloco de `POST /leads/intake`
- `apps/web/src/features/clientes/api/types.ts:12-38` — `interface Client`, única no front
- `apps/web/src/features/clientes/tabs/DadosTab.tsx:78-118` — render do `Client`; `:99` é o ponto de inserção
- `apps/web/src/features/clientes/tabs/DadosTab.tsx:7-39, 46-59` — primitivos `Row` e `Section`
- `apps/web/src/features/ajuda/CaptacaoDocPage.tsx:16-24` — obrigação de atualizar no mesmo PR
- `apps/web/src/features/ajuda/CaptacaoDocPage.tsx:73-153, 282-287` — tabela de campos e a contagem à mão
- `apps/web/src/features/legal/PrivacidadePage.tsx:209-210, 261, 607` — nega rastreadores publicitários
- `apps/web/src/lib/labels.ts:14-31, 203-225` — `make()` para enums; `Record` irmão para descrições
- `ROADMAP.md:272-283` — Fase 16, motor de regras
- `ROADMAP.md:285-302` — Fase 17-B/17-C, WhatsApp
- `specs/plans/2026-07-28-fase-17a-entrada-de-lead.md:1500-1507` — lead reincidente não reescreve atribuição
- `specs/plans/2026-07-28-fase-17a-entrada-de-lead.md:1531-1538` — tag × `sourceId`
- `specs/plans/2026-08-04-fase-19b-plataforma-aberta.md:2189-2228` — catálogo de finalidades, fundamentação
- `specs/plans/2026-08-04-fase-19b-plataforma-aberta.md:53` — "o CRM registra, não comunica"
- `specs/research/2026-07-28-fase-17a-entrada-de-lead.md:245` — o `site-v2` vive fora deste repositório
