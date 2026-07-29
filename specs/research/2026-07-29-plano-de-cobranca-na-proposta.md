---
date: 2026-07-29T08:34:28-03:00
researcher: claude
git_commit: ff30ccfb08dd2db55d555fb939dbc2519749f8e8
branch: main
topic: "Plano de cobrança na proposta e derivação do contrato"
tags: [research, proposals, finance, contracts, prisma, migration]
status: complete
---

# Research: Plano de cobrança na proposta e derivação do contrato

## Research Question

A `Proposal` passa a carregar os dados que definem o `Contract`:

- `billingType` (`RECURRING | INSTALLMENTS | ONE_TIME`, mesmo enum do contrato), **obrigatório na criação** (coluna nullable apenas para o histórico já gravado).
- Apenas a **estrutura** de cobrança — percentual/valor de entrada, nº de parcelas, dia de vencimento, duração.
- **Prazos relativos ao aceite** em dias (offsets), nunca datas absolutas: a derivação ancora em `decidedAt`.
- Dinheiro **não** é duplicado: valores saem dos itens/`total` (centavos, sobra na última parcela, molde de `computeTotal`).
- `paymentTerms` (texto livre) permanece como observação complementar, rebaixado de verdade para nuance.
- Geração do contrato é **um clique com tela de conferência** (não automática no aceite): nova rota `POST /contracts/from-proposal/:id` no `FinanceModule`, que passa a importar `ProposalsModule` e valida posse e status do `proposalId`.
- Idempotência via **unique parcial** em `Contract.proposalId` (`WHERE "proposalId" IS NOT NULL`).

Mapear também: `newVersion` clonando o plano; ausência de gate de permissão no botão "Criar contrato"; `Contract.proposalId` gravado e nunca renderizado; `createFromDeal` gravando `proposalId` null; e o efeito de `total` passar a significar "valor mensal" em proposta `RECURRING` sobre o bloco de propostas do dashboard.

## Summary

Hoje **proposta e contrato não se falam no backend**. A proposta é um documento comercial com valores (`items` → `total`), validade e dois campos de texto livre (`paymentTerms`, `deliveryTime`); o contrato é o regime de cobrança (`billingType` + parâmetros + datas absolutas) que materializa `Payment`. A única ligação é uma **costura de UI**: `PropostaDetalhePage` mostra "Criar contrato" quando `status === 'ACCEPTED'` e abre o `ContratoFormDialog` do módulo financeiro com quatro defaults (`clientId`, descrição, `proposalId`, `suggestedAmount`). Desses, só `proposalId` chega ao body; `suggestedAmount` preenche `installmentAmount` **apenas** no regime `INSTALLMENTS`. O backend recebe `proposalId` sem validação nenhuma — há comentário explícito no service declarando a decisão.

A mudança tem quatro frentes. **(1) Modelo**: colunas novas em `Proposal` para o plano de cobrança, reaproveitando o enum `BillingType` já existente, mais offsets em dias; migration aditiva + unique parcial em `Contract.proposalId`, que exige checagem de duplicata preexistente e invariante nova em `invariantes.sql` (o portão `validar-migrations-com-dados.sh` é obrigatório pelas regras de `apps/api/CLAUDE.md`). **(2) Derivação**: função pura no `FinanceModule` que recebe plano + `total` + data-âncora e devolve os campos de `Contract` e a agenda — o `schedule.ts` atual já é exatamente essa camada pura e serve de molde e de destino. **(3) Fronteira**: `FinanceModule` passa a importar `ProposalsModule`; hoje nenhum dos dois conhece o outro (só o `app.module.ts` referencia ambos), então a direção é acíclica e é ela que habilita a validação de posse/status que faltava. **(4) UI**: campos do plano no `ProposalFormDialog`, tela de conferência substituindo o form cru na geração, gate de permissão no CTA, e render do vínculo nas duas fichas.

O ponto de atenção não-óbvio é semântico, não técnico: com `RECURRING` na proposta, `Proposal.total` passa a significar "valor mensal", e `DashboardRepository.proposalsOpen` soma `total` de todas as propostas em aberto (`DRAFT|SENT|NEGOTIATING`) num único número apresentado como valor em aberto — passaria a somar mensalidade com valor à vista. Nada quebra; o número muda de significado.

## Codebase Map

### Afetados — backend

| Arquivo | Papel | Relevância |
|---|---|---|
| [prisma/schema.prisma:472-506](apps/api/prisma/schema.prisma#L472-L506) | Model `Proposal` | Recebe as colunas do plano de cobrança. `paymentTerms` L488, `validUntil` L490, `discount` L491, `total` L492, relação `contracts` L495, `decidedAt` L498 |
| [prisma/schema.prisma:578-605](apps/api/prisma/schema.prisma#L578-L605) | Model `Contract` | `proposalId` L585-586 recebe o unique parcial. Campos-destino da derivação: L588-598 |
| [prisma/schema.prisma:739-743](apps/api/prisma/schema.prisma#L739-L743) | `enum BillingType` | Reaproveitado pela proposta sem alteração |
| [proposals/application/proposals.service.ts:70-109](apps/api/src/modules/proposals/application/proposals.service.ts#L70-L109) | `create` | Passa a persistir o plano; `computeTotal` já é chamado aqui (L83) |
| [proposals.service.ts:111-167](apps/api/src/modules/proposals/application/proposals.service.ts#L111-L167) | `update` | Dois caminhos (com e sem `items`); o plano entra nos dois. Trava DRAFT em L117-121 |
| [proposals.service.ts:244-286](apps/api/src/modules/proposals/application/proposals.service.ts#L244-L286) | `newVersion` | **Clone campo a campo** (L252-276) — o plano tem de ser acrescentado aqui ou a versão nova nasce sem ele |
| [proposals/api/dto/create-proposal.dto.ts:15-44](apps/api/src/modules/proposals/api/dto/create-proposal.dto.ts#L15-L44) | DTO de criação | Onde o plano se torna obrigatório. `paymentTerms` opcional em L38 permanece |
| [proposals/api/dto/update-proposal.dto.ts:4-6](apps/api/src/modules/proposals/api/dto/update-proposal.dto.ts#L4-L6) | DTO de edição | `PartialType(OmitType(Create, ['clientId','dealId']))` — herda o plano automaticamente, **inclusive a opcionalidade** |
| [finance/application/contracts.service.ts:98-126](apps/api/src/modules/finance/application/contracts.service.ts#L98-L126) | `create` | L103-105 é o comentário que declara a ausência de validação cruzada — o alvo da mudança |
| [finance/application/contracts.service.ts:128-191](apps/api/src/modules/finance/application/contracts.service.ts#L128-L191) | `createByBillingType` | Monta a agenda por regime; a derivação alimenta esse mesmo caminho |
| [finance/application/schedule.ts:27-64](apps/api/src/modules/finance/application/schedule.ts#L27-L64) | Agenda pura | Molde e destino da função de derivação; `addMonths` (L16-20) já resolve o problema de fuso |
| [finance/domain/contract.repository.ts:22-37](apps/api/src/modules/finance/domain/contract.repository.ts#L22-L37) | Interface do repo | **Não tem** `findByProposalId` — necessário para idempotência e para listar contratos de uma proposta |
| [finance/finance.module.ts:14-26](apps/api/src/modules/finance/finance.module.ts#L14-L26) | Módulo | Importa `ClientsModule`, `DataModule`; passa a importar `ProposalsModule` |
| [finance/api/contracts.controller.ts:32-36](apps/api/src/modules/finance/api/contracts.controller.ts#L32-L36) | Controller | Molde da rota nova (`financeiro:gerenciar`). Atenção à ordem: rota literal antes de `:id` (comentário em L38) |
| [projects/application/projects.service.ts:149-168](apps/api/src/modules/projects/application/projects.service.ts#L149-L168) | `createFromDeal` | L167: `proposalId` fica null — a quebra da corrente cliente→proposta→projeto |
| [prisma/fixtures/invariantes.sql](apps/api/prisma/fixtures/invariantes.sql) | Portão de migration | Recebe o bloco novo (unique parcial + plano coerente) |
| [apps/api/ENDPOINTS.md:623-703, 863-927](apps/api/ENDPOINTS.md#L863) | Doc de endpoints | Rota nova documentada no mesmo commit (Definition of Done). Molde: `POST /contracts` em L871 |

### Afetados — frontend

| Arquivo | Papel | Relevância |
|---|---|---|
| [propostas/ProposalFormDialog.tsx:29-46](apps/web/src/features/propostas/ProposalFormDialog.tsx#L29-L46) | Schema Zod | Onde o plano entra como obrigatório (campo sem `.optional()` → asterisco obrigatório na label) |
| [ProposalFormDialog.tsx:50-76](apps/web/src/features/propostas/ProposalFormDialog.tsx#L50-L76) | `EMPTY` / `toValues` | Ambos precisam do plano; `toValues` é o caminho de edição |
| [ProposalFormDialog.tsx:204-288](apps/web/src/features/propostas/ProposalFormDialog.tsx#L204-L288) | Coluna direita | Onde os campos do plano ficam, ao lado de `paymentTerms` (L279-282) |
| [propostas/PropostaDetalhePage.tsx:219-224](apps/web/src/features/propostas/PropostaDetalhePage.tsx#L219-L224) | CTA "Criar contrato" | **Sem `useCan`** — o arquivo não importa o hook; vira "Gerar contrato" com gate `financeiro:gerenciar` |
| [PropostaDetalhePage.tsx:352-359](apps/web/src/features/propostas/PropostaDetalhePage.tsx#L352-L359) | Uso do `ContratoFormDialog` | Substituído pela tela de conferência |
| [PropostaDetalhePage.tsx:239-270](apps/web/src/features/propostas/PropostaDetalhePage.tsx#L239-L270) | Grid de dados | Onde o plano é exibido; e onde falta a seção "contratos gerados" |
| [financeiro/ContratoFormDialog.tsx:138-146](apps/web/src/features/financeiro/ContratoFormDialog.tsx#L138-L146) | Props | `defaultProposalId` / `suggestedAmount` deixam de ser o mecanismo de costura |
| [ContratoFormDialog.tsx:206-214](apps/web/src/features/financeiro/ContratoFormDialog.tsx#L206-L214) | Efeito de sugestão | A heurística que a derivação substitui (só INSTALLMENTS, ignora RECURRING/ONE_TIME) |
| [financeiro/ContratoDetalhePage.tsx:155-210](apps/web/src/features/financeiro/ContratoDetalhePage.tsx#L155-L210) | Cabeçalho | Não menciona a proposta de origem; é aqui que o link entra |
| [propostas/api/types.ts:16-56](apps/web/src/features/propostas/api/types.ts#L16-L56) | Tipos | `Proposal`, `CreateProposalBody`, `UpdateProposalBody` ganham o plano |
| [financeiro/api/types.ts:30-71](apps/web/src/features/financeiro/api/types.ts#L30-L71) | Tipos | `Contract.proposalId` já existe (L35) |
| [clientes/ClienteDetalheLayout.tsx:76-94](apps/web/src/features/clientes/ClienteDetalheLayout.tsx#L76-L94) | Abas do cliente | Padrão de filtro por `canAny` (L94) — referência do gate correto |
| [lib/labels.ts:68-73](apps/web/src/lib/labels.ts#L68-L73) | `BILLING_TYPE_LABELS` | Já traduz os três regimes; reaproveitado na proposta sem duplicar |
| [lib/query-keys.ts:30-57](apps/web/src/lib/query-keys.ts#L30-L57) | Chaves de cache | Gerar contrato invalida `proposals` **e** `contracts` |

### Padrões existentes a seguir

**Dinheiro sempre em centavos, arredondando linha a linha**

```ts
// apps/api/src/modules/proposals/application/money.ts:11-26
export function computeTotal(
  items: { quantity: number; unitPrice: number }[],
  discount?: number,
): number {
  const gross = items.reduce(
    (sum, it) => sum + toCents(it.quantity * it.unitPrice),
    0,
  );
  const net = Math.max(0, gross - toCents(discount ?? 0));
  return fromCents(net);
}
```

**Por que importa**: é o molde exato da derivação de valores. `finance/application/money.ts` é uma cópia deliberada deste arquivo (a regra "feature não importa interior de outra"), então a função nova de rateio nasce em `finance/application/`, ao lado de `schedule.ts`.

**Agenda como função pura, testável sem banco**

```ts
// apps/api/src/modules/finance/application/schedule.ts:27-50
export function buildInstallmentSchedule(input: {
  downPayment?: number | null;
  downPaymentDueDate?: Date | null;
  installments: number;
  installmentAmount: number;
  firstInstallmentDueDate: Date;
}): ScheduledCharge[] {
```

**Por que importa**: a derivação (plano + total + âncora → campos do contrato + cobranças) tem a mesma forma — entra dado, sai agenda, zero I/O. `schedule.spec.ts` já existe como molde de teste. Note que hoje `buildInstallmentSchedule` **recebe** `installmentAmount` pronto e a soma é exata por construção; com o valor derivado do total, o rateio precisa decidir onde vai a sobra de centavos.

**Somar mês preservando o dia, em UTC**

```ts
// apps/api/src/modules/finance/application/schedule.ts:16-20
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}
```

**Por que importa**: o comentário L9-15 documenta que usar `setMonth` (hora local) desloca o dia em fuso negativo — exatamente o caso de UTC-3. Qualquer aritmética de data na derivação usa os campos UTC.

**Transição de status como tabela declarativa**

```ts
// apps/api/src/modules/proposals/application/proposals.service.ts:25-32
const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['SENT'],
  SENT: ['NEGOTIATING', 'ACCEPTED', 'REJECTED'],
  ...
};
```

**Por que importa**: `ACCEPTED` é terminal. A validação "só proposta aceita gera contrato" é leitura de status, não transição nova — o aceite continua sendo o único caminho para `ACCEPTED`.

**Posse validada pela raiz (cliente), 404 e não 403**

```ts
// apps/api/src/modules/proposals/application/proposals.service.ts:295-304
private async loadOwned(ownerId: string, id: string): Promise<ProposalWithItems> {
  const proposal = await this.repo.findById(id);
  if (!proposal) throw new NotFoundException('Proposta não encontrada.');
  await this.clients.findOne(ownerId, proposal.clientId); // 404 se não for do dono
  return proposal;
}
```

**Por que importa**: é o molde para validar o `proposalId` na rota nova. `ContractsService.loadOwned` (L284-293) é idêntico. O `ProposalsService` já é exportado pelo `ProposalsModule` (L19), então `findOne(ownerId, id)` é a porta pública pronta para uso.

**Auditoria agregada, um registro por intenção do usuário**

```ts
// apps/api/src/modules/proposals/application/proposals.service.ts:232-240
await this.audit.registrar({
  entity: 'PROPOSAL', entityId: id, entityLabel: proposal.number,
  action: 'ACEITAR', antes: proposal, depois: accepted,
  extra: { dealMovidoParaGanhou: proposal.dealId !== null },
});
```

**Por que importa**: gerar contrato é uma intenção só, mesmo criando N `Payment`. O molde de "um registro agregado, não N" está em `ContractsService.cancel` (L269-280). Os enums `AuditEntity` (schema L790-806) e `AuditAction` (L809-834) **não têm** ação de "gerar" — `CRIAR` em `CONTRACT` com `extra: { propostaId, propostaNumero }` cabe sem migration de enum.

### Fluxo de dados atual

```
CRIAÇÃO DA PROPOSTA
ProposalFormDialog (items, discount, paymentTerms texto livre)
  → POST /proposals → ProposalsService.create
  → computeTotal(items, discount) → Proposal.total          [proposals.service.ts:83]

ACEITE
PropostaDetalhePage "Aceitar" → POST /proposals/:id/accept
  → status ACCEPTED + decidedAt                             [proposals.service.ts:224-227]
  → moveDealToWon(dealId) se houver                          [L229, L312-324]
      → DealsService.move → estágio isWon
          → ProjectsService.createFromDeal → Project (proposalId NULL)  [projects.service.ts:167]
  ✗ nada de contrato

CONTRATO (hoje: costura só de UI)
PropostaDetalhePage, status===ACCEPTED → botão "Criar contrato"   [PropostaDetalhePage.tsx:219]
  → ContratoFormDialog(defaultClientId, defaultDescription, defaultProposalId, suggestedAmount)
      → usuário digita regime, datas e valores à mão
      → suggestedAmount → installmentAmount SÓ em INSTALLMENTS   [ContratoFormDialog.tsx:206-214]
  → POST /contracts { …, proposalId }                            [ContratoFormDialog.tsx:245]
      → ContractsService.create: valida SÓ clientId               [contracts.service.ts:102-105]
      → createByBillingType → buildInstallmentSchedule|buildOneTimeSchedule → Payment[]
      → Contract.proposalId gravado, nunca lido em tela nenhuma
```

### Estado da relação `Proposal ↔ Contract`

| Fato | Verificado em |
|---|---|
| `Contract.proposalId` é `String?`, FK `SET NULL`, **sem unique** | schema L585-586 |
| Índices de `Contract`: `[clientId, status]` e `[ownerId]` — nenhum em `proposalId` | schema L603-604; [migration](apps/api/prisma/migrations/20260723204059_add_contract_indexes/migration.sql) |
| `ContractRepository` não expõe busca por proposta | contract.repository.ts:22-37 |
| Nenhuma tela renderiza `proposalId` | busca por `proposalId` em `apps/web/src`: só `ContratoFormDialog.tsx:245` e os tipos |
| `ProposalsModule` e `FinanceModule` não se conhecem | única referência cruzada é `app.module.ts:75,77` |

## External Research

Nenhuma dependência nova. Tudo se resolve com o que já está no projeto:

- **Prisma** — unique parcial (`WHERE`) não é expressável no schema do Prisma; entra como SQL cru na migration, e o `@@unique` fica de fora. O projeto já tem precedente documentado para invariante que "o schema do Prisma não expressa": o bloco de `isFollowUp` em [invariantes.sql](apps/api/prisma/fixtures/invariantes.sql) diz literalmente "não existe índice parcial (o schema do Prisma não o expressa)".
- **class-validator** — `@ValidateIf((o) => o.billingType === 'X')` é o padrão de campo condicional por regime, já usado em [create-contract.dto.ts:36-87](apps/api/src/modules/finance/api/dto/create-contract.dto.ts#L36-L87).
- **Zod** — `superRefine` para validação cruzada entre campos do regime, já usado em [ContratoFormDialog.tsx:58-117](apps/web/src/features/financeiro/ContratoFormDialog.tsx#L58-L117).

## Historical Context

**A ausência do plano na proposta é herança de fase, não decisão de domínio.**

- [research fase 5:204](specs/research/2026-07-23-fase-5-financeiro.md#L204) — a pergunta aberta era onde costurar "proposta aceita → contrato": "(a) criar o Contrato automaticamente em `proposals.accept` (idempotente por `proposalId`) … (b) apenas **sugerir** via CTA/dialog no frontend (SPEC §3.6 diz 'sugere criar contrato')". Resolveu-se por (b).
- [plan fase 5:1010-1034](specs/plans/2026-07-23-fase-5-financeiro.md#L1010-L1034) — a costura especificada é exatamente o que existe hoje, com os quatro defaults.
- [plan fase 5:1080](specs/plans/2026-07-23-fase-5-financeiro.md#L1080) — **a limitação a encerrar**: "Se quisermos validar posse do `projectId`/`proposalId` informado, seria preciso importar `ProjectsModule`/`ProposalsModule` … **Decisão**: validar apenas o `clientId`; `projectId`/`proposalId` são opcionais e de baixo risco — aceitar sem validação cruzada nesta fase para não acoplar módulos. (Registrar como limitação conhecida.)"
- [research fase 4](specs/research/2026-07-23-fase-4-demandas.md) — registra que a Fase 3 resolveu "aceita sugere criar Projeto e Contrato" como "só marca `ACCEPTED`/`decidedAt` + move deal", com Projeto e Contrato deferidos, e que as FKs `Project.proposalId` / `Contract.proposalId` / `Activity.proposalId` são `SET NULL`.
- **SPEC.md §3.6** — "Proposta **aceita** sugere criar contrato, pré-preenchendo cliente, valor total e condições de pagamento." O "valor total" e as "condições de pagamento" nunca foram implementados no pré-preenchimento; só cliente e descrição.
- **ROADMAP.md L380-391 (Fase 11, P1, não iniciada)** — "Proposta que o cliente vê": PDF, link público de aceite com token de uso único, envio por e-mail. Registra que "hoje `POST /proposals/:id/send` só marca `sentAt`, não envia nada", e prevê "templates de proposta reutilizáveis (escopo, condições, itens padrão)". **O plano de cobrança estruturado é insumo direto desse PDF e desses templates** — é a mesma informação, e fazê-lo antes evita retrabalho na Fase 11.

**Decisões tomadas nesta sessão** (input do usuário, não conclusão da pesquisa):

1. Prazos **relativos ao aceite** (offsets em dias), ancorados em `decidedAt`.
2. Plano **obrigatório na criação**; coluna nullable só para o histórico.
3. Valores **derivados** dos itens/`total`; sem campos de dinheiro próprios no plano.
4. Geração por **um clique com tela de conferência**, não automática no aceite.

## Constraints & Considerations

**Migration com dado dentro é portão obrigatório** ([apps/api/CLAUDE.md](apps/api/CLAUDE.md)). O unique parcial em `Contract.proposalId` é troca de constraint: exige invariante nova em `invariantes.sql` e rodada local de `scripts/validar-migrations-com-dados.sh`. Dois riscos concretos:
- **Duplicata preexistente** em produção reprova o `CREATE UNIQUE INDEX`. A migration precisa detectar e decidir (falhar com mensagem clara é preferível a desempatar sozinha qual contrato "vale").
- A fixture `banco-populado.sql` usa **só colunas do `init`** e não tem `Contract`; o índice não seria exercitado por ela. A invariante nova tem de afirmar a propriedade (unicidade e ausência de plano meio-preenchido), no molde do bloco de encerramento de conta, que confere exatamente esse tipo de par.

**Nullable no banco + obrigatório no DTO é um par assimétrico deliberado**, e `UpdateProposalDto` é `PartialType(OmitType(Create))` — herda o plano como **opcional** automaticamente. Um `PATCH` que mande `billingType` sem os campos condicionais do regime passa pelo `@ValidateIf` sem reclamar (a condição olha `o.billingType`, que veio) mas pode deixar o registro incoerente. A coerência do conjunto precisa de validação de objeto inteiro no service, não só de campo no DTO.

**`decidedAt` é a âncora e é imutável na prática** — gravado no `accept` (L226) e o status é terminal. Mas propostas **já aceitas** (histórico) não têm plano: a tela de geração precisa de um caminho para elas — hoje é o único caminho, e continuará necessário enquanto existir proposta aceita sem plano.

**RECURRING não tem "total" natural.** `Proposal.total` é Σ dos itens. Com o regime recorrente, esse número significa "valor mensal", e [dashboard.repository proposalsOpen:62-72](apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L62-L72) soma `total` de `DRAFT|SENT|NEGOTIATING` num só valor. Consequência aceita na decisão desta sessão (documentar no schema, marcar "/mês" na UI); o bloco do dashboard passa a misturar grandezas.

**`RECURRING` + offsets tem uma tensão a resolver no `/spec`**: `Contract.billingDay` é 1–28 (dia do mês), não offset. Início do contrato pode ser offset do aceite, mas o dia de cobrança é dia do mês — o plano recorrente é "offset de início + dia de vencimento", forma mista. `endDate` vira duração em meses (ou indeterminado).

**Rateio de centavos é regra nova.** `buildInstallmentSchedule` hoje recebe `installmentAmount` já pronto e a soma fecha por construção (comentário L25). Derivando de `total`, `(total − entrada) / N` quase nunca é redondo — precisa de regra explícita e testada de onde vai a sobra.

**Ordem de rota no controller**: `POST /contracts/from-proposal/:id` tem de ser declarada antes de qualquer `:id` que possa capturá-la — o `contracts.controller.ts` já traz o comentário desse cuidado em L38 (por causa de `GET /contracts/export`).

**Regras de projeto que valem sem exceção**: pt-BR em toda mensagem nova (validação, toast, exceção); enum nunca renderizado cru (`BILLING_TYPE_LABELS` já existe); campo obrigatório usa a prop `required` do `FieldLabel`; nada de modal sobre modal (a tela de conferência abre a partir da ficha, não sobre outro diálogo); `ENDPOINTS.md` atualizado no mesmo commit; nenhum `PrismaService` em `application/`; log estruturado com `evento` em pt-BR no formato `substantivo.acao_no_passado` (ex.: `contrato.derivado_de_proposta`).

**Cobertura**: `schedule.spec.ts`, `contracts.service.spec.ts`, `proposals.service.spec.ts` e `money.spec.ts` já existem e são os arquivos a estender. Não há e2e de propostas nem de contratos (`apps/api/test/` cobre auth, RLS, conta, dados, integrações, lead intake) — a rota nova roda dentro da transação do `OwnerContextInterceptor`, então não cai na regra de e2e obrigatório para rota `@Public()`.

## Open Questions

1. **`RECURRING` na proposta: como expressar duração?** Meses de vigência (`durationMonths`, null = indeterminado) ou continuar em `endDate` absoluto no contrato? Afeta o formato do plano e a tela de conferência.
2. **Sobra de centavos no rateio**: última parcela absorve, primeira absorve, ou distribuir de um em um nas primeiras? Precisa de decisão antes do teste.
3. **Entrada em percentual ou valor?** A decisão foi "sem campos de dinheiro próprios", o que aponta para percentual — mas entrada redonda ("R$ 3.000 de entrada num total de R$ 11.480") é como se negocia na prática. Percentual puro pode gerar entradas quebradas.
4. **Propostas já aceitas sem plano**: a geração manual (form cru atual) continua disponível em paralelo à derivada, ou a tela de conferência aceita o preenchimento à mão quando não há plano?
5. **Unicidade por proposta ou por cadeia de versões?** Versões compartilham `number` mas são linhas distintas. Unique em `proposalId` permite um contrato por versão — duas versões da mesma proposta poderiam gerar dois contratos. Travar por cadeia exigiria constraint sobre `number`, que não está em `Contract`.
6. **`createFromDeal` recebendo a proposta**: a decisão foi mapear, não necessariamente corrigir agora. Entra no mesmo escopo ou vira item separado? Exigiria `PipelineModule`/`ProjectsModule` conhecerem a proposta que originou o ganho.

## Code References Index

- `apps/api/prisma/schema.prisma:472-506` — model `Proposal`
- `apps/api/prisma/schema.prisma:488` — `paymentTerms String?`
- `apps/api/prisma/schema.prisma:492` — `total Decimal @db.Decimal(12,2)`
- `apps/api/prisma/schema.prisma:498` — `decidedAt DateTime?` (âncora da derivação)
- `apps/api/prisma/schema.prisma:578-605` — model `Contract`
- `apps/api/prisma/schema.prisma:585-586` — `proposalId` (alvo do unique parcial)
- `apps/api/prisma/schema.prisma:603-604` — índices atuais de `Contract`
- `apps/api/prisma/schema.prisma:708-715` — `enum ProposalStatus`
- `apps/api/prisma/schema.prisma:739-743` — `enum BillingType`
- `apps/api/prisma/schema.prisma:790-834` — `AuditEntity` / `AuditAction`
- `apps/api/src/modules/proposals/application/proposals.service.ts:25-32` — transições permitidas
- `apps/api/src/modules/proposals/application/proposals.service.ts:70-109` — `create`
- `apps/api/src/modules/proposals/application/proposals.service.ts:111-167` — `update` (trava DRAFT em 117-121)
- `apps/api/src/modules/proposals/application/proposals.service.ts:221-242` — `accept`
- `apps/api/src/modules/proposals/application/proposals.service.ts:244-286` — `newVersion` (clone campo a campo)
- `apps/api/src/modules/proposals/application/proposals.service.ts:295-304` — `loadOwned`
- `apps/api/src/modules/proposals/application/money.ts:11-26` — `computeTotal`
- `apps/api/src/modules/proposals/api/dto/create-proposal.dto.ts:15-44` — DTO de criação
- `apps/api/src/modules/proposals/api/dto/update-proposal.dto.ts:4-6` — `PartialType(OmitType(...))`
- `apps/api/src/modules/proposals/proposals.module.ts:11-21` — exporta `ProposalsService`
- `apps/api/src/modules/finance/application/contracts.service.ts:98-126` — `create`
- `apps/api/src/modules/finance/application/contracts.service.ts:103-105` — comentário da limitação
- `apps/api/src/modules/finance/application/contracts.service.ts:128-191` — `createByBillingType`
- `apps/api/src/modules/finance/application/contracts.service.ts:269-280` — auditoria agregada (molde)
- `apps/api/src/modules/finance/application/schedule.ts:16-20` — `addMonths` (UTC)
- `apps/api/src/modules/finance/application/schedule.ts:27-64` — agendas puras
- `apps/api/src/modules/finance/api/dto/create-contract.dto.ts:36-87` — `@ValidateIf` por regime
- `apps/api/src/modules/finance/api/contracts.controller.ts:32-38` — molde da rota + ordem de declaração
- `apps/api/src/modules/finance/domain/contract.repository.ts:22-37` — interface sem `findByProposalId`
- `apps/api/src/modules/finance/finance.module.ts:14-26` — imports do módulo
- `apps/api/src/modules/projects/application/projects.service.ts:149-168` — `createFromDeal` (`proposalId` null em 167)
- `apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts:62-72` — `proposalsOpen` soma `total`
- `apps/api/src/shared/permissions.ts:84,90,123,129` — `proposta:*` e `financeiro:*`
- `apps/api/prisma/fixtures/invariantes.sql` — portão de migration com dado
- `apps/api/ENDPOINTS.md:871` — `POST /contracts` (molde de doc)
- `apps/web/src/features/propostas/ProposalFormDialog.tsx:29-46` — schema Zod
- `apps/web/src/features/propostas/ProposalFormDialog.tsx:204-288` — coluna dos dados da proposta
- `apps/web/src/features/propostas/PropostaDetalhePage.tsx:219-224` — CTA sem gate de permissão
- `apps/web/src/features/propostas/PropostaDetalhePage.tsx:352-359` — costura atual
- `apps/web/src/features/propostas/api/types.ts:16-56` — tipos da proposta
- `apps/web/src/features/financeiro/ContratoFormDialog.tsx:138-146` — props de costura
- `apps/web/src/features/financeiro/ContratoFormDialog.tsx:206-214` — heurística de `suggestedAmount`
- `apps/web/src/features/financeiro/ContratoDetalhePage.tsx:155-210` — cabeçalho sem a proposta
- `apps/web/src/features/clientes/ClienteDetalheLayout.tsx:94` — filtro de abas por `canAny`
- `apps/web/src/lib/labels.ts:68-73` — `BILLING_TYPE_LABELS`
- `apps/web/src/lib/query-keys.ts:30-57` — chaves de `proposals` e `contracts`
- `specs/plans/2026-07-23-fase-5-financeiro.md:1010-1034` — costura especificada
- `specs/plans/2026-07-23-fase-5-financeiro.md:1080` — limitação conhecida a encerrar
- `specs/research/2026-07-23-fase-5-financeiro.md:204` — pergunta aberta original
- `ROADMAP.md:380-391` — Fase 11 (proposta que o cliente vê)
- `SPEC.md:186` — "proposta aceita sugere criar contrato"
