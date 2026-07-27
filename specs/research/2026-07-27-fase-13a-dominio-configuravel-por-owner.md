---
date: 2026-07-27T16:29:57-03:00
researcher: claude
git_commit: 32d499542ff31b672f9b8b5bc3676625f43787bd
branch: main
topic: "Fase 13-A — Domínio configurável pelo owner (catálogo de serviços, fontes de lead, tipos de atividade, motivos de perda)"
tags: [research, pipeline, clients, activities, proposals, projects, rls, migration]
status: complete
---

# Research: Fase 13-A — Domínio configurável pelo owner

## Research Question

Substituir quatro listas fechadas em código por catálogos editáveis **por owner**:

1. **`ServiceType`** — enum fechado (`SOFTWARE | WEBSITE | PAID_TRAFFIC`), [`schema.prisma:518`](../../apps/api/prisma/schema.prisma#L518)
2. **`LeadSource`** — enum, [`schema.prisma:503`](../../apps/api/prisma/schema.prisma#L503)
3. **`ActivityType`** — enum, [`schema.prisma:583`](../../apps/api/prisma/schema.prisma#L583)
4. **`Deal.lostReason`** — texto livre, [`schema.prisma:260`](../../apps/api/prisma/schema.prisma#L260)

Escopo em [ROADMAP.md](../../ROADMAP.md) → "Fase 13 — Frente A", 1º da Trilha de produção.
**Fora de escopo:** campos customizados (Frente B).

## Summary

O precedente existe e é exato: a Fase 7A converteu `PipelineStage` de tabela global compartilhada
para tabela por owner com RLS. A receita SQL, o molde de policy, o padrão de repositório, a tela de
configuração e o provisionamento por conta já estão escritos e em produção — a Fase 13-A é
principalmente **replicar aquele padrão quatro vezes**. O `pipeline-stages` é o template de ponta a
ponta: controller, service, DTOs, repositório, `StageConfigDialog.tsx` e a seção do `ENDPOINTS.md`.

**Mas as quatro listas não são quatro cópias do mesmo problema — são quatro migrations de formatos
diferentes**, e essa é a descoberta central desta pesquisa:

| Lista | Colunas afetadas | Nulável | Dificuldade | Motivo |
|---|---|---|---|---|
| `LeadSource` | 1 (`Client.source`) | ✅ sim | **baixa** | display + 1 filtro de igualdade; zero branch |
| `lostReason` | 1 (`Deal.lostReason`) | ✅ sim | **baixa-média** | não é enum: é texto livre → mapear string→linha; 1 regra de 422 a preservar |
| `ServiceType` | **3** (`Deal`, `Proposal`, `Project`) | ❌ **NOT NULL** | **média-alta** | backfill obrigatório de FK em 3 tabelas com dado vivo; 2 cópias de valor entre registros |
| `ActivityType` | 1 (`Activity.type`) | ❌ NOT NULL | **alta** | **2 branches server-side em `'FOLLOW_UP'`**, uma delas num cron cross-owner que bypassa RLS |

O `ActivityType` é o mais caro apesar de ser o menor enum: `FOLLOW_UP` não é rótulo, é **regra**. O
cron de notificações e o dashboard filtram por `type: 'FOLLOW_UP'` literal, e o cron roda sem
contexto de owner pelo client admin. Virar FK por owner tira o único filtro daquela query.

No frontend há um acoplamento estrutural: **`Object.keys(LABELS)` é hoje o catálogo de fato**. Os
`Select` de serviço, origem e tipo de atividade derivam suas opções do mapa de tradução em
[`labels.ts`](../../apps/web/src/lib/labels.ts), que é um módulo de **tempo de compilação**. Esta é a
primeira lista do projeto vinda de runtime, e ela quebra esse padrão uniforme — incluindo o
`enumFilter` de [`use-url-filters.ts:29`](../../apps/web/src/hooks/use-url-filters.ts#L29), que valida
query param de URL contra uma allowlist compilada.

## Codebase Map

### O precedente: Fase 7A (a receita a copiar)

- [plano](../plans/2026-07-26-fase-7a-funil-por-owner.md) · [pesquisa](2026-07-26-fase-7-funil-por-owner-e-responsavel.md)
- Migration: [`20260726120000_pipeline_stages_per_owner/migration.sql`](../../apps/api/prisma/migrations/20260726120000_pipeline_stages_per_owner/migration.sql)

> ⚠️ **O bloco de SQL do plano é a versão que quebrou. Copie o arquivo da migration, não o plano.**
> A migration como escrita no plano derrubou a API em produção por **11 horas** e foi corrigida em
> `ac5c84d fix(pipeline): derruba o unique de name antes de replicar os estágios`. O erro: o
> `DROP INDEX "PipelineStage_name_key"` estava no fim, mas a replicação insere cópias com os **mesmos
> nomes** do template ainda presente na tabela — a primeira cópia estourava o índice. Passou no CI
> porque o banco de teste nasce sem `User`, o `CROSS JOIN` não insere nada e o caminho perigoso nunca
> era percorrido. Isso virou a regra obrigatória em
> [`apps/api/CLAUDE.md:113-140`](../../apps/api/CLAUDE.md#L113) → "Migration é validada com dado dentro".

**A ordem obrigatória, verificada no arquivo** (`migration.sql`, cabeçalhos de seção nas linhas
indicadas):

| Passo | Linha | O que faz | Por que nesta posição |
|---|---|---|---|
| 0 | :16 | Guard de integridade — `RAISE EXCEPTION` se filho tem `ownerId` órfão | aborta antes de escrever |
| 1 | :39 | `ADD COLUMN "ownerId" TEXT` **nulável** | `ADD COLUMN NOT NULL` do Prisma falha com dado |
| 2 | :44 | Semeia o template se a tabela estiver vazia | dá fonte à replicação num banco novo |
| 3 | :66 | **`DROP INDEX` do unique global** | ⚠️ as cópias repetem os nomes do template |
| 4 | :79 | Replica por owner via `CROSS JOIN` sobre `User` | — |
| 5 | :100 | `UPDATE` filhos → cópia do próprio owner, **depois** `DELETE` do template | FK é `ON DELETE RESTRICT` |
| 6 | :118 | `SET NOT NULL` + índice + FK | só depois do backfill |
| 7 | :126 | `CREATE UNIQUE INDEX (ownerId, name)` | o global caiu no passo 3 |
| 8 | :131 | RLS: `ENABLE` + `FORCE` + policy + `GRANT` | — |

Detalhes que valem para as quatro tabelas novas: `ownerId` é `TEXT` (comparação text=text, **sem
`::uuid`**); ids são `TEXT` → `gen_random_uuid()::text`; `WHERE u."ownerId" IS NULL` é o predicado
canônico de "é owner"; a migration roda como `crm_user` (superuser, bypassa RLS) → não precisa de
`set_config`.

**O molde de RLS** (`migration.sql:138-148`) — copiar literalmente por tabela nova:

```sql
ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "X" FORCE  ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON "X"
  FOR ALL
  USING      ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "X" TO crm_app;
```

`current_setting(…, true)` é `missing_ok` → contexto ausente vira NULL → policy casa zero linhas
(**fail-closed**, nunca erro). Policy sempre chamada `owner_isolation`. `USING` e `WITH CHECK`
idênticos. `FORCE` sempre.

### Arquivos afetados

**Backend — schema e migration**

| Arquivo | Papel | Relevância |
|---|---|---|
| [`prisma/schema.prisma:518`](../../apps/api/prisma/schema.prisma#L518) | `enum ServiceType` | remover; campos em `Deal:256`, `Proposal:292`, `Project:337` — os três **NOT NULL sem default** |
| [`prisma/schema.prisma:503`](../../apps/api/prisma/schema.prisma#L503) | `enum LeadSource` | remover; campo `Client.source:180` nulável |
| [`prisma/schema.prisma:583`](../../apps/api/prisma/schema.prisma#L583) | `enum ActivityType` | remover; campo `Activity.type:441` NOT NULL |
| [`prisma/schema.prisma:260`](../../apps/api/prisma/schema.prisma#L260) | `Deal.lostReason String?` | vira FK nulável; não há enum a remover |
| [`prisma/schema.prisma:234-246`](../../apps/api/prisma/schema.prisma#L234) | `model PipelineStage` | **o molde**: `ownerId`, `@@unique([ownerId, name])`, `@@index([ownerId])`, `onDelete: Cascade` |
| [`prisma/fixtures/banco-populado.sql:57-63`](../../apps/api/prisma/fixtures/banco-populado.sql#L57) | fixture do portão | 3 `INSERT` de `Deal` com `"serviceType"` literal — o portão vai exigir tratamento |
| [`prisma/fixtures/invariantes.sql`](../../apps/api/prisma/fixtures/invariantes.sql) | invariantes do portão | **obrigatório** acrescentar bloco por migration de backfill |
| [`prisma/seed.ts`](../../apps/api/prisma/seed.ts) | seed de dev | 23 literais de `ServiceType`, 12 de `LeadSource`, 10 de `ActivityType`, 1 `lostReason` |

**Backend — o template a espelhar (`pipeline-stages`)**

| Arquivo | Papel |
|---|---|
[`api/pipeline-stages.controller.ts`](../../apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts) | 5 rotas; `@RequirePermission`; `@Patch('reorder')` **antes** de `@Patch(':id')`
[`application/pipeline-stages.service.ts`](../../apps/api/src/modules/pipeline/application/pipeline-stages.service.ts) | 409 de nome duplicado, `maxOrder+1`, permutação exata no reorder (422), **guard 409 de exclusão** (:101-109)
[`domain/pipeline-stage.repository.ts`](../../apps/api/src/modules/pipeline/domain/pipeline-stage.repository.ts) | interface + token DI `Symbol()`
[`infra/prisma-pipeline-stage.repository.ts`](../../apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts) | `findFirst` (nunca `findUnique` por id), `updateMany`/`deleteMany` com `ownerId`, `countDeals` incluindo arquivados (:67-74)
[`application/pipeline-stages.service.spec.ts`](../../apps/api/src/modules/pipeline/application/pipeline-stages.service.spec.ts) | mock da interface; testes de 409, de owner alheio e de reorder inválido

**Backend — pontos de escrita e cópia de valor**

| Arquivo:linha | O que faz | Por que importa |
|---|---|---|
| [`projects.service.ts:146`](../../apps/api/src/modules/projects/application/projects.service.ts#L146) | `createFromDeal` copia `serviceType: deal.serviceType` | vira cópia de FK — **precisa de guard cross-owner** |
| [`proposals.service.ts:246`](../../apps/api/src/modules/proposals/application/proposals.service.ts#L246) | `newVersion` copia `serviceType` da origem | idem |
| [`deals.service.ts:150-177`](../../apps/api/src/modules/pipeline/application/deals.service.ts#L150) | `move()` — a regra do `lostReason` | ver abaixo |
| [`clients.service.ts:47`](../../apps/api/src/modules/clients/application/clients.service.ts#L47) | `create` faz `{ ...dto }` | `source` entra por spread — renomear o campo silenciosamente passa |

**⚠️ `ActivityType` — os dois branches server-side em `FOLLOW_UP`**

```ts
// apps/api/src/modules/notifications/infra/prisma-notification-triggers.repository.ts:31-38
async followUpsDoDia(de: Date, ate: Date): Promise<AlvoDeLembrete[]> {
  // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
  const alvos = await this.admin.activity.findMany({
    where: {
      type: 'FOLLOW_UP',
      completedAt: null,
      scheduledFor: { gte: de, lte: ate },
    },
```

```ts
// apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:176-186
  where: { client: { ownerId }, type: 'FOLLOW_UP', completedAt: null, scheduledFor: { not: null } }
```

O primeiro é um **cron cross-owner que bypassa RLS**. Com `type` virando FK por owner, `type: 'FOLLOW_UP'`
deixa de existir como valor comparável — a query precisa de um predicado que atravesse owners, o que
pede uma **coluna booleana na linha do catálogo** (o análogo de `isWon`/`isLost` em `PipelineStage`).

Há uma **inconsistência já existente** que a fase deve resolver: a UI da timeline usa outro predicado —
[`TimelineTab.tsx:194`](../../apps/web/src/features/clientes/tabs/TimelineTab.tsx#L194)
`const pendingFollowUp = !!activity.scheduledFor && !activity.completedAt;` — enquanto API e dashboard
usam `type === 'FOLLOW_UP'`. Duas regras para a mesma pergunta.

**A regra do `lostReason` a preservar** ([`deals.service.ts:159-168`](../../apps/api/src/modules/pipeline/application/deals.service.ts#L159)):

```ts
if (targetStage.isLost) {
  const reason = dto.lostReason?.trim();
  if (!reason) throw new UnprocessableEntityException('Informe o motivo da perda.');
  patch.lostReason = reason;
} else if (stageChanged) {
  patch.lostReason = null; // saiu de "Perdeu" → limpa o motivo
}
```

Só é gravável por `PATCH /deals/:id/move` — deliberadamente ausente de `create-deal.dto.ts` e
`update-deal.dto.ts`. O DTO marca `@IsOptional()`; a obrigatoriedade é **condicional no service**, daí
o 422 em vez de 400. E `lostReason` é **write-only na UI**: nenhum componente renderiza
`deal.lostReason` — quem fizer a lista configurável também constrói o primeiro caminho de leitura.

**Frontend**

| Arquivo:linha | Papel |
|---|---|
| [`lib/labels.ts:9-12`](../../apps/web/src/lib/labels.ts#L9) | `make<T>()` — fallback `map[value] ?? value` devolve a chave crua se não mapeada |
| [`lib/labels.ts:20-27`](../../apps/web/src/lib/labels.ts#L20) | `LEAD_SOURCE_LABELS` + `translateLeadSource` |
| [`lib/labels.ts:37-42`](../../apps/web/src/lib/labels.ts#L37) | `SERVICE_TYPE_LABELS` + `translateServiceType` |
| [`lib/labels.ts:120-128`](../../apps/web/src/lib/labels.ts#L120) | `ACTIVITY_TYPE_LABELS` + `translateActivityType` |
| [`StageConfigDialog.tsx`](../../apps/web/src/features/pipeline/StageConfigDialog.tsx) | **a tela-molde**: dnd-kit, rename inline no blur, `ConfirmDialog`, `extractApiMessage` |
| [`api/hooks.ts:91-143`](../../apps/web/src/features/pipeline/api/hooks.ts#L91) | molde TanStack: `invalidateStages` invalida também `['deals','board']`; só reorder é otimista |
| [`hooks/use-url-filters.ts:29`](../../apps/web/src/hooks/use-url-filters.ts#L29) | `enumFilter` valida query param contra allowlist **compilada** |

**Os três `Select` que derivam opções de `Object.keys(LABELS)`** — o acoplamento a romper:

- `ServiceType`: [`DealFormDialog.tsx:247`](../../apps/web/src/features/pipeline/DealFormDialog.tsx#L247) · [`ProposalFormDialog.tsx:250`](../../apps/web/src/features/propostas/ProposalFormDialog.tsx#L250) · [`ProjectFormDialog.tsx:204`](../../apps/web/src/features/demandas/ProjectFormDialog.tsx#L204)
- `LeadSource`: [`ClientFormDialog.tsx:463`](../../apps/web/src/features/clientes/ClientFormDialog.tsx#L463) · filtro em [`ClientesListPage.tsx:68,190`](../../apps/web/src/features/clientes/ClientesListPage.tsx#L68)
- `ActivityType`: [`TimelineTab.tsx:131`](../../apps/web/src/features/clientes/tabs/TimelineTab.tsx#L131)

Cada um carrega ainda um **`z.enum([...])` hardcoded** e, no caso de `ServiceType`, um **default
`'SOFTWARE'` hardcoded** (`DealFormDialog.tsx:82,104`; `ProposalFormDialog.tsx:52`;
`ProjectFormDialog.tsx:61,77`). Com catálogo por owner não existe default universal.

**Tipos duplicados** (nenhum módulo compartilhado): `ServiceType` declarado 3× (`pipeline`,
`propostas`, `demandas` → `api/types.ts:4`); `ActivityType` 3× (`clientes/api/types.ts:4`,
`dashboard/api/types.ts:4-10`, e o `z.enum` em `TimelineTab.tsx:31`).

**Sites de exibição só-leitura** (6 para `ServiceType`): `DealCard.tsx:33`,
`OportunidadesTab.tsx:51`, `PropostasListPage.tsx:191`, `PropostaDetalhePage.tsx:242`,
`ProjetosListPage.tsx:177`, `ProjetoDetalhePage.tsx:146`.

### Máquina transversal que cada tabela nova precisa plugar

**RLS / contexto** — [`owner-context.interceptor.ts:44-48`](../../apps/api/src/prisma/owner-context.interceptor.ts#L44): uma
`$transaction` por requisição autenticada, `SELECT set_config('app.owner_id', ${ownerId}, true)` como
primeira statement, `tx` no CLS. O valor é `req.access.ownerId` (o **owner da workspace**, não quem
está logado) — é o que faz colaborador ler as linhas do owner. Repositórios acessam via
[`prisma.service.ts:53-55`](../../apps/api/src/prisma/prisma.service.ts#L53) `get db()`. Não há
`$extends` nem `$use` em nenhum lugar: o `ownerId` no `where` é **convenção manual**.

**Permissões** — catálogo em [`shared/permissions.ts`](../../apps/api/src/shared/permissions.ts), 21
chaves em 6 categorias, convenção `recurso:acao`. Precedente relevante: **configurar o funil não tem
chave própria** — reusa `oportunidade:gerenciar`, justificado no comentário do controller:
*"Configurar o funil é gerir o pipeline, então as escritas exigem `oportunidade:gerenciar`."*
Acrescentar chave nova exige só editar o array: `ALL_PERMISSION_KEYS`, `GET /permissions` e o papel
`system` são derivados em runtime.

**Auditoria** — `AuditEntity` é enum Prisma ([`schema.prisma:603`](../../apps/api/prisma/schema.prisma#L603),
12 valores) e o comentário diz *"Cresce conforme a trilha cobre mais domínio"* → entidade nova exige
mudança de schema. **Verificado: `PipelineStagesService` não chama `AuditService` — tabela de
configuração hoje não é auditada.**

**Exclusão** — **verificado: tabela de configuração é hard-delete com guard 409, não soft delete.**
`PipelineStage` não tem `archivedAt`, não está em `TrashType`
([`trash.repository.ts:3-4`](../../apps/api/src/modules/trash/domain/trash.repository.ts#L3), 5 tipos), e
`delete()` conta filhos primeiro — **incluindo arquivados**, porque a FK é `RESTRICT` e um filho na
lixeira responderia 500. A mensagem do 409 avisa disso.

**Provisionamento por conta** — [`users.service.ts`](../../apps/api/src/modules/users/users.service.ts),
**dois caminhos** (`create:108-124` senha, `createWithOAuth:153-178` OAuth), ambos por
`this.admin` (`PrismaAdminService`, superuser) no mesmo nested create, porque o cadastro não tem
contexto de owner. Semeia hoje: assinatura trial, papel `system`, estágios do funil, destinos de
notificação. Fonte única da lista:
[`shared/default-pipeline-stages.ts`](../../apps/api/src/shared/default-pipeline-stages.ts) — com
**terceiro consumidor** em [`seed.ts:109`](../../apps/api/prisma/seed.ts#L109). Log de
provisionamento em `users.service.ts:70-77` (`evento: 'funil.estagios_provisionados'`).

**Portão de migration com dado** ([`apps/api/CLAUDE.md:113-140`](../../apps/api/CLAUDE.md#L113)) —
obrigatório: [`scripts/validar-migrations-com-dados.sh`](../../apps/api/scripts/validar-migrations-com-dados.sh),
fixture [`banco-populado.sql`](../../apps/api/prisma/fixtures/banco-populado.sql) (dois owners),
invariantes [`invariantes.sql`](../../apps/api/prisma/fixtures/invariantes.sql). Rodar local antes do PR:

```
DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh
```

**Teste de RLS a atualizar** — [`test/rls.e2e-spec.ts:82-89`](../../apps/api/test/rls.e2e-spec.ts#L82)
afirma `count(*) FROM pg_policies WHERE schemaname='public'` **= 18**. Cada tabela nova sobe esse
número; subir junto com a migration é parte do trabalho.

### Fluxo de dados

Hoje, para os quatro: valor literal do enum no `POST`/`PATCH` → `@IsEnum` no DTO → gravado como enum
nativo do Postgres → devolvido cru na resposta → traduzido no web por `translate*()`. Sem tabela,
sem FK, sem join, e **sem nenhuma agregação** (confirmado: os únicos `groupBy` do projeto são por
`stageId`, `status` de proposta e em `prisma-payment.repository.ts:188` — nenhum por `serviceType`,
`source`, `type` de atividade ou `lostReason`).

Depois: id de FK no corpo → validação de pertencimento ao owner (padrão `stages.findOne`) → FK →
resposta precisa **incluir a linha do catálogo** (nome) para a UI exibir sem um segundo request.

## Constraints & Considerations

- **Colisão de nome entre model e enum no Prisma.** Model e enum compartilham namespace: não é
  possível ter `model LeadSource` e `enum LeadSource` no mesmo schema. O enum tem de sair na mesma
  mudança — e o significado do tipo gerado `LeadSource` muda de união de strings para tipo de model,
  o que é um rename semântico que atravessa a API. Vale escolher os nomes de tabela antes de começar.
- **`PAID_TRAFFIC` existe nos dois enums** — `ServiceType.PAID_TRAFFIC` e `LeadSource.PAID_TRAFFIC`, e
  ambos têm o rótulo `'Tráfego pago'` (`labels.ts:22` e `:39`). Busca-e-substitui cega no literal ou no
  rótulo corrompe o outro. A [pesquisa da Fase 14](2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md)
  já registra essa colisão.
- **`ServiceType` é NOT NULL em três tabelas.** Não há caminho "nulável primeiro": ou a coluna FK
  nova nasce nulável e o backfill a preenche antes do `SET NOT NULL` (o padrão do passo 1/6 da 7A), ou
  a migration falha com dado dentro.
- **A replicação deve partir das linhas reais, não dos valores presumidos.** Foi a lição da 7A: owner
  que já customizou tem a customização preservada. Aqui os enums não são customizáveis, então o
  template é fixo — mas o `lostReason` **é** texto livre e cada owner tem strings próprias.
- **Produção está aberta com autocadastro** (`REGISTRATION_ENABLED=true`, `crm.programeai.com.br`) →
  há N owners reais agora, com dado real. A migration não é reentrante e não tem down script;
  `pg_dump` antes é obrigatório (a 7A registrou isso).
- **`prisma migrate dev` não gera essa migration** — emite `ADD COLUMN ... NOT NULL`, que falha com
  dado. Usar `--create-only` e escrever à mão.
- **Downtime**: `ALTER TABLE`/`DROP INDEX` pegam `ACCESS EXCLUSIVE`. Aplicar fora do pico.
- **`labels.ts` é módulo de compile-time** e o header dele declara a invariante "ao adicionar um valor
  ao schema, inclua a tradução aqui no mesmo PR" — invariante que deixa de fazer sentido para lista de
  runtime. O `make()` cai para a chave crua quando não mapeada, o que exibiria **UUID** nas 6 telas de
  leitura se a resposta não trouxer o nome.
- **`ENDPOINTS.md` é Definition of Done** — formato fixo de 6 rótulos (Propósito / Auth / Body /
  Resposta / Erros / Handler); a seção "Pipeline stages" (`:336-383`) é o modelo.
- **Log estruturado obrigatório** — `evento` em pt-BR `substantivo.acao_no_passado`, registrado em
  [`docs/observabilidade.md`](../../docs/observabilidade.md). `console.log` é proibido.

## Open Questions

Precisam de decisão humana **antes** do `/spec`:

1. **`ActivityType` entra nesta fase?** É o mais caro dos quatro (cron cross-owner que bypassa RLS +
   dashboard + 3 pontos no web), e é o único cujo valor carrega **regra**, não rótulo. Sair dele
   deixaria a fase com 3 catálogos e um enum. Se entrar, a solução natural é uma coluna booleana na
   linha do catálogo (tipo `isFollowUp`), espelhando `isWon`/`isLost` — o que também resolveria a
   divergência de predicado entre `TimelineTab.tsx:194` e as duas queries do servidor.

2. **Excluir ou desativar item de catálogo?** O precedente (`PipelineStage`) é hard-delete com 409 se
   houver filhos. Para `ServiceType` isso significa 3 contagens (`Deal`, `Proposal`, `Project`), e um
   owner com histórico nunca conseguirá apagar um serviço que já usou — na prática o item fica preso
   para sempre. Catálogo costuma preferir "desativar" (sai do `Select`, registro antigo mantém o
   rótulo). Isso divergiria do precedente de propósito.

3. **Permissão: reusar ou criar?** O precedente reusa `oportunidade:gerenciar` para configurar o
   funil. Mas estes quatro catálogos atravessam domínios diferentes (pipeline, clientes, timeline,
   propostas/projetos) — reusar exigiria 3 chaves diferentes para 4 telas da mesma seção de
   configuração. Uma chave nova de `Organização` (ex.: `catalogo:gerenciar`) unificaria.

4. **`lostReason`: migrar o texto existente ou começar limpo?** Hoje é texto livre por owner. Opções:
   (a) manter a coluna texto e acrescentar FK nulável — nada se perde, dois caminhos coexistem;
   (b) mapear as strings distintas de cada owner para linhas de catálogo — preserva o histórico, mas o
   resultado é sujo (typos e frases longas viram itens); (c) FK nova e histórico zerado. A decisão
   muda o tamanho da migration.

5. **Catálogos auditados?** `PipelineStage` não é. Se estes forem, `AuditEntity` precisa de valores
   novos (mudança de enum no schema).

6. **Uma migration ou quatro?** As quatro listas são independentes e de dificuldades muito
   diferentes. Quatro migrations separadas permitem entregar `LeadSource` (a mais barata) primeiro e
   validar o padrão antes de encarar `ServiceType` nas 3 tabelas.

## Code References Index

**Precedente**
- [`migrations/20260726120000_pipeline_stages_per_owner/migration.sql`](../../apps/api/prisma/migrations/20260726120000_pipeline_stages_per_owner/migration.sql) — a receita; passos 0-8
- [`specs/plans/2026-07-26-fase-7a-funil-por-owner.md`](../plans/2026-07-26-fase-7a-funil-por-owner.md) — plano; **o SQL dele é a versão quebrada**
- [`apps/api/CLAUDE.md:113`](../../apps/api/CLAUDE.md#L113) — "Migration é validada com dado dentro"

**Schema**
- [`schema.prisma:234-246`](../../apps/api/prisma/schema.prisma#L234) — `PipelineStage`, o molde
- [`schema.prisma:503`](../../apps/api/prisma/schema.prisma#L503) `LeadSource` · [`:518`](../../apps/api/prisma/schema.prisma#L518) `ServiceType` · [`:583`](../../apps/api/prisma/schema.prisma#L583) `ActivityType` · [`:260`](../../apps/api/prisma/schema.prisma#L260) `Deal.lostReason`
- [`schema.prisma:180`](../../apps/api/prisma/schema.prisma#L180) `Client.source` · [`:256`](../../apps/api/prisma/schema.prisma#L256) `Deal.serviceType` · [`:292`](../../apps/api/prisma/schema.prisma#L292) `Proposal.serviceType` · [`:337`](../../apps/api/prisma/schema.prisma#L337) `Project.serviceType` · [`:441`](../../apps/api/prisma/schema.prisma#L441) `Activity.type`
- [`schema.prisma:603`](../../apps/api/prisma/schema.prisma#L603) `AuditEntity` · [`:619`](../../apps/api/prisma/schema.prisma#L619) `AuditAction`

**Template de CRUD por owner**
- [`pipeline-stages.controller.ts`](../../apps/api/src/modules/pipeline/api/pipeline-stages.controller.ts) · [`pipeline-stages.service.ts:101`](../../apps/api/src/modules/pipeline/application/pipeline-stages.service.ts#L101) guard 409 · [`pipeline-stage.repository.ts`](../../apps/api/src/modules/pipeline/domain/pipeline-stage.repository.ts) · [`prisma-pipeline-stage.repository.ts:67`](../../apps/api/src/modules/pipeline/infra/prisma-pipeline-stage.repository.ts#L67) `countDeals`
- [`StageConfigDialog.tsx`](../../apps/web/src/features/pipeline/StageConfigDialog.tsx) · [`api/hooks.ts:91`](../../apps/web/src/features/pipeline/api/hooks.ts#L91) · [`ENDPOINTS.md:336-383`](../../apps/api/ENDPOINTS.md#L336)

**Pontos de risco**
- [`prisma-notification-triggers.repository.ts:34`](../../apps/api/src/modules/notifications/infra/prisma-notification-triggers.repository.ts#L34) — `type: 'FOLLOW_UP'` em cron cross-owner que bypassa RLS
- [`prisma-dashboard.repository.ts:180`](../../apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L180) — `type: 'FOLLOW_UP'`
- [`TimelineTab.tsx:82,153,194`](../../apps/web/src/features/clientes/tabs/TimelineTab.tsx#L82) — 3 branches + o predicado divergente
- [`deals.service.ts:159`](../../apps/api/src/modules/pipeline/application/deals.service.ts#L159) — 422 do `lostReason`
- [`projects.service.ts:146`](../../apps/api/src/modules/projects/application/projects.service.ts#L146) · [`proposals.service.ts:246`](../../apps/api/src/modules/proposals/application/proposals.service.ts#L246) — cópias de valor entre registros

**Transversal**
- [`owner-context.interceptor.ts:44`](../../apps/api/src/prisma/owner-context.interceptor.ts#L44) · [`prisma.service.ts:53`](../../apps/api/src/prisma/prisma.service.ts#L53) · [`shared/permissions.ts`](../../apps/api/src/shared/permissions.ts) · [`audit.service.ts:58`](../../apps/api/src/modules/audit/audit.service.ts#L58) · [`shared/purge.ts`](../../apps/api/src/shared/purge.ts)
- [`users.service.ts:108,153`](../../apps/api/src/modules/users/users.service.ts#L108) — os dois caminhos de cadastro · [`shared/default-pipeline-stages.ts`](../../apps/api/src/shared/default-pipeline-stages.ts) — fonte única · [`seed.ts:109`](../../apps/api/prisma/seed.ts#L109) — terceiro consumidor
- [`test/rls.e2e-spec.ts:89`](../../apps/api/test/rls.e2e-spec.ts#L89) — `expect(18)` a subir · [`fixtures/invariantes.sql`](../../apps/api/prisma/fixtures/invariantes.sql) · [`scripts/validar-migrations-com-dados.sh`](../../apps/api/scripts/validar-migrations-com-dados.sh)

**Web — o acoplamento a romper**
- [`labels.ts:9,20,37,120`](../../apps/web/src/lib/labels.ts#L9) · [`use-url-filters.ts:29`](../../apps/web/src/hooks/use-url-filters.ts#L29) `enumFilter`
- `Select` de `ServiceType`: [`DealFormDialog.tsx:247`](../../apps/web/src/features/pipeline/DealFormDialog.tsx#L247) · [`ProposalFormDialog.tsx:250`](../../apps/web/src/features/propostas/ProposalFormDialog.tsx#L250) · [`ProjectFormDialog.tsx:204`](../../apps/web/src/features/demandas/ProjectFormDialog.tsx#L204)
- `Select` de `LeadSource`: [`ClientFormDialog.tsx:463`](../../apps/web/src/features/clientes/ClientFormDialog.tsx#L463) · [`ClientesListPage.tsx:68`](../../apps/web/src/features/clientes/ClientesListPage.tsx#L68)
- `Select` de `ActivityType`: [`TimelineTab.tsx:131`](../../apps/web/src/features/clientes/tabs/TimelineTab.tsx#L131)
- [`LostReasonDialog.tsx`](../../apps/web/src/features/pipeline/LostReasonDialog.tsx) — textarea livre → vira `Select`
