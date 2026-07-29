---
date: 2026-07-29T09:22:30-03:00
author: claude
source_prd: specs/research/2026-07-29-plano-de-cobranca-na-proposta.md
git_commit: bda3d6e0e5d37ca29db008749914c39792760fb1
branch: main
status: draft
tags: [spec, proposals, finance, contracts, prisma, migration]
---

# Spec: Plano de cobrança na proposta e derivação do contrato

## Overview

A `Proposal` passa a carregar a **estrutura** de cobrança que hoje só existe no `Contract`: regime (`billingType`), prazos como **offsets em dias relativos ao aceite**, dia de vencimento, duração, número de parcelas e entrada. Nenhum valor em dinheiro é duplicado — os valores saem de `total` (que já é calculado no backend a partir dos itens) na hora da derivação. `paymentTerms` continua existindo como observação em texto livre, rebaixado a nuance.

Com o plano gravado, gerar o contrato deixa de ser "abrir o formulário cru e digitar tudo de novo" e passa a ser **um clique com tela de conferência**: uma função pura recebe plano + `total` + `decidedAt` e devolve os campos do `Contract` mais a agenda de `Payment`. A tela mostra o resultado, deixa ajustar o **plano** (não os campos do contrato) e refaz a prévia a cada ajuste — assim o rateio de centavos e o valor da última parcela nunca atravessam a rede nem são recalculados no frontend. Isso encerra a limitação registrada em [plan fase 5:1080](specs/plans/2026-07-23-fase-5-financeiro.md#L1080): o `FinanceModule` passa a importar o `ProposalsModule` e valida posse e status do `proposalId` que hoje aceita sem olhar.

A estratégia é quatro fases em duas metades: backend primeiro (modelo e plano; derivação e rotas), frontend depois (plano no formulário; tela de conferência e vínculo nas duas fichas). As duas primeiras fecham com `pnpm --filter api test` e o portão de migration com dado; as duas últimas com build e teste manual na tela.

## Current State

Proposta e contrato não se falam no backend. A única ligação é uma costura de UI: [PropostaDetalhePage.tsx:352-359](apps/web/src/features/propostas/PropostaDetalhePage.tsx#L352-L359) abre o `ContratoFormDialog` com quatro defaults, dos quais só `proposalId` chega ao body, e [contracts.service.ts:103-105](apps/api/src/modules/finance/application/contracts.service.ts#L103-L105) declara em comentário que não valida nada além do `clientId`. `Contract.proposalId` é gravado e nunca renderizado em tela nenhuma.

`FinanceModule` importa apenas `ClientsModule` e `DataModule`; `ProposalsModule` já exporta `ProposalsService`. A direção `finance → proposals` é acíclica. `Contract` já tem RLS habilitado e forçado (`20260724050000_enable_rls`). Detalhes completos no PRD.

## Desired End State

- `Proposal` tem 8 colunas de plano de cobrança, todas nullable no banco (só pelo histórico) e **obrigatórias no `CreateProposalDto`**. `newVersion` clona o plano.
- `Contract.proposalId` é `@unique`: no máximo um contrato por proposta, e quantos contratos se quiser sem proposta.
- Existe uma função pura `derivarContrato({ plano, total, ancora })` em `finance/application/proposal-plan.ts` que devolve os campos do contrato e a agenda de cobranças, com a sobra de centavos toda na última parcela.
- Três rotas novas: `POST /contracts/from-proposal/:proposalId/preview` (deriva sem gravar), `POST /contracts/from-proposal/:proposalId` (deriva e grava) e `GET /contracts/by-proposal/:proposalId` (contratos da cadeia de versões).
- Gerar contrato de proposta que não está `ACCEPTED` responde `422`; de proposta cuja **cadeia de versões** já gerou contrato responde `409` nomeando o contrato existente; duas requisições simultâneas resultam em um contrato só (o índice único derruba a segunda, traduzida para `409`).
- O `ProposalFormDialog` pede o plano; a ficha da proposta exibe o plano em uma frase legível, marca o total como mensalidade quando o regime é `RECURRING` e lista os contratos gerados.
- A ficha do contrato aponta para a proposta de origem.
- A costura antiga (`defaultProposalId`, `suggestedAmount` e a heurística de `installmentAmount` em [ContratoFormDialog.tsx:206-214](apps/web/src/features/financeiro/ContratoFormDialog.tsx#L206-L214)) deixa de existir.

## Decisões desta sessão

Resolvem as seis perguntas abertas do PRD. São premissas do spec, não pontos a rediscutir durante a implementação.

1. **Duração do `RECURRING`**: coluna `durationMonths Int?` no plano (null = tempo indeterminado). A derivação faz `endDate = addMonths(startDate, durationMonths)`.
2. **Sobra de centavos**: a **última parcela absorve**. As N−1 primeiras ficam no valor redondo que a proposta anunciou.
3. **Entrada**: percentual **ou** valor, mutuamente exclusivos (`downPaymentPercent` XOR `downPaymentAmount`), com a exclusividade afirmada em `invariantes.sql` porque nenhuma constraint do banco a expressa.
4. **Tela de conferência editável**: a prévia vem do backend e é recalculada a cada ajuste. O que se edita é o **plano**; os campos do contrato e o rateio são sempre derivados.
5. **Unicidade**: `@unique` em `Contract.proposalId` (idempotência técnica) **mais** bloqueio por cadeia de versões no service, respondendo `409` em pt-BR.
6. **`createFromDeal` recebendo a proposta**: fora de escopo.

**Correção ao PRD — o índice parcial não é necessário.** O PRD parte de "unique parcial (`WHERE "proposalId" IS NOT NULL`) não é expressável no Prisma, então entra como SQL cru". No PostgreSQL, NULLs são distintos por padrão (`NULLS DISTINCT`), então um `UNIQUE` comum numa coluna nullable **já permite N NULLs** — exatamente o comportamento desejado. `proposalId String? @unique` no schema entrega a garantia de forma nativa, sem artefato SQL-only e sem o risco de um `prisma migrate dev` propor derrubar um índice que o Prisma não conhece. A migration ainda precisa do bloco `DO $$` detectando duplicata preexistente **antes** do `CREATE UNIQUE INDEX`, e a invariante continua afirmando a unicidade entre os não-nulos.

## What We're NOT Doing

- **`ProjectsService.createFromDeal` continuar gravando `proposalId: null`** ([projects.service.ts:167](apps/api/src/modules/projects/application/projects.service.ts#L167)). Exigiria `PipelineModule`/`ProjectsModule` conhecerem a proposta que originou o ganho — frente própria, decisão 6.
- **Ajustar `DashboardRepository.proposalsOpen`** ([prisma-dashboard.repository.ts:62-72](apps/api/src/modules/dashboard/infra/prisma-dashboard.repository.ts#L62-L72)). Com `RECURRING` na proposta, esse número passa a somar mensalidade com valor à vista. Consequência aceita no PRD; a mitigação aqui é só de rótulo (marcar "/mês" onde o total de uma proposta recorrente aparece). Separar as grandezas no dashboard é decisão de produto à parte.
- **Gerar o contrato automaticamente no aceite.** Continua sendo um clique explícito (decisão do PRD).
- **Validar `projectId` cruzado.** O `FinanceModule` passa a importar `ProposalsModule`, não `ProjectsModule`; `projectId` segue aceito sem validação de posse. O comentário em `contracts.service.create` é reescrito para dizer isso, em vez de ser apagado.
- **PDF da proposta e link público de aceite.** Fase 11 do roadmap. O plano estruturado é insumo dela, mas a entrega é outra.
- **e2e novo.** As rotas novas rodam dentro da transação do `OwnerContextInterceptor` (não são `@Public()`), então não caem na regra de e2e obrigatório de `apps/api/CLAUDE.md`. A cobertura é de spec unitário.

---

## Phase 1: Modelo e plano na proposta

### Goal

`Proposal` passa a persistir um plano de cobrança coerente, `Contract.proposalId` fica único, e o portão de migration com dado afirma as duas propriedades.

### Changes

#### Modelo de dados

**Modify**: `apps/api/prisma/schema.prisma` — model `Proposal` (após `total`, L504)

```prisma
  total        Decimal        @db.Decimal(12, 2) // calculado no backend
  // ⚠ Em proposta de plano RECURRING, `total` significa VALOR MENSAL (Σ dos
  // itens é a mensalidade). Quem soma `total` de várias propostas mistura
  // grandezas — é o caso de DashboardRepository.proposalsOpen.
  // --- plano de cobrança (estrutura que deriva o Contract) ------------------
  // Só a ESTRUTURA e os PRAZOS. Nenhum valor sai daqui: os valores vêm de
  // `total` na derivação (finance/application/proposal-plan.ts). Os prazos são
  // OFFSETS EM DIAS relativos ao aceite, nunca datas absolutas — o plano é
  // escrito antes de existir aceite, e a derivação ancora em `decidedAt`.
  // Nullable no banco só pelo histórico já gravado; obrigatório no DTO.
  billingType           BillingType? // RECURRING | INSTALLMENTS | ONE_TIME
  startOffsetDays       Int? // dias após o aceite: startDate (REC) | 1ª parcela (INST) | vencimento (ONE)
  // RECURRING
  billingDay            Int? // 1–28 (dia do mês, não offset — Contract.billingDay é assim)
  durationMonths        Int? // null = tempo indeterminado
  // INSTALLMENTS
  downPaymentPercent    Decimal? @db.Decimal(5, 2) // 0–100, exclusivo com downPaymentAmount
  downPaymentAmount     Decimal? @db.Decimal(12, 2) // exclusivo com downPaymentPercent
  downPaymentOffsetDays Int? // dias após o aceite p/ a entrada
  installments          Int? // qtd de parcelas (sem contar a entrada)
  items        ProposalItem[]
```

**Modify**: `apps/api/prisma/schema.prisma` — model `Contract`, L597-598

```prisma
  // Um contrato por proposta: é a idempotência da derivação (dois cliques no
  // botão "Gerar contrato" não podem virar dois contratos). No Postgres NULLs
  // são distintos, então este @unique numa coluna nullable já vale "no máximo
  // um contrato por proposta E quantos contratos se quiser sem proposta" — não
  // é preciso índice parcial. A regra mais forte (um contrato por CADEIA de
  // versões) fica no ContractsService: `number` não existe aqui.
  proposalId        String?        @unique
  proposal          Proposal?      @relation(fields: [proposalId], references: [id])
```

**Create**: `apps/api/prisma/migrations/20260818100000_proposal_billing_plan/migration.sql`

```sql
-- Plano de cobrança na proposta --------------------------------------------
-- Aditiva e nullable: proposta já gravada não tem plano, e continuará gerando
-- contrato pela tela de conferência preenchida à mão. Obrigatório é o
-- CreateProposalDto, não a coluna — par assimétrico deliberado.
ALTER TABLE "Proposal" ADD COLUMN "billingType" "BillingType";
ALTER TABLE "Proposal" ADD COLUMN "startOffsetDays" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "billingDay" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "durationMonths" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "downPaymentPercent" DECIMAL(5,2);
ALTER TABLE "Proposal" ADD COLUMN "downPaymentAmount" DECIMAL(12,2);
ALTER TABLE "Proposal" ADD COLUMN "downPaymentOffsetDays" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "installments" INTEGER;

-- Um contrato por proposta -------------------------------------------------
-- Troca de constraint com dado dentro. `CREATE UNIQUE INDEX` reprova se
-- produção já tiver duas linhas com o mesmo proposalId, e reprova com mensagem
-- crua do Postgres ("could not create unique index") que não diz QUAL proposta.
-- Falhar antes, nomeando a proposta e a contagem, é melhor que desempatar
-- sozinho qual contrato "vale": essa escolha é do owner, não da migration.
DO $$
DECLARE duplicadas TEXT;
BEGIN
  SELECT string_agg(t."proposalId" || ' (' || t.n || ' contratos)', ', ')
    INTO duplicadas
    FROM (
      SELECT "proposalId", count(*) AS n
        FROM "Contract"
       WHERE "proposalId" IS NOT NULL
       GROUP BY "proposalId"
      HAVING count(*) > 1
    ) t;
  IF duplicadas IS NOT NULL THEN
    RAISE EXCEPTION
      'Há proposta(s) com mais de um contrato: %. Cancele ou desvincule os contratos excedentes antes de aplicar esta migration.',
      duplicadas;
  END IF;
END $$;

-- NULLs são distintos no Postgres: este índice vale "no máximo um contrato por
-- proposta" E "quantos contratos se quiser sem proposta". Nenhum índice parcial
-- é necessário, e por isso o @unique cabe no schema do Prisma (sem SQL-only,
-- sem risco de `migrate dev` propor derrubá-lo por drift).
CREATE UNIQUE INDEX "Contract_proposalId_key" ON "Contract"("proposalId");
```

**Modify**: `apps/api/prisma/fixtures/invariantes.sql` — bloco novo no fim do arquivo

```sql
-- ---------------------------------------------------------------------------
-- Plano de cobrança na proposta (20260818100000_proposal_billing_plan)
-- ---------------------------------------------------------------------------
-- As colunas nascem nulas e a migration é aditiva, então não há backfill a
-- conferir. O que se afirma aqui é (a) a unicidade que a derivação usa como
-- idempotência e (b) a REGRA do conjunto, que nenhuma constraint expressa: o
-- plano é coerente com o próprio regime, e a entrada é percentual OU valor,
-- nunca os dois. Plano meio-preenchido não estoura nada — ele deriva um
-- contrato errado, com parcela a menos ou entrada dobrada, e isso vira
-- cobrança emitida para o cliente do owner.
DO $$
DECLARE
  indices       INT;
  duplicadas    INT;
  incoerentes   INT;
  entrada_dupla INT;
BEGIN
  -- O índice tem de existir E ser único. Migration futura que recrie a tabela
  -- Contract derrubaria a idempotência sem nada reclamar: dois cliques no botão
  -- "Gerar contrato" passariam a gerar dois contratos.
  SELECT count(*) INTO indices
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
   WHERE c.relname = 'Contract'
     AND i.indisunique
     AND i.indnatts = 1
     AND (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum = i.indkey[0]) = 'proposalId';
  IF indices = 0 THEN
    RAISE EXCEPTION 'Não há índice UNIQUE em "Contract"("proposalId") — a idempotência da derivação de contrato caiu.';
  END IF;

  SELECT count(*) INTO duplicadas FROM (
    SELECT "proposalId" FROM "Contract"
     WHERE "proposalId" IS NOT NULL
     GROUP BY "proposalId" HAVING count(*) > 1
  ) t;
  IF duplicadas > 0 THEN
    RAISE EXCEPTION 'Há % proposta(s) com mais de um contrato — o índice único não está valendo.', duplicadas;
  END IF;

  -- Coerência por regime. `billingType IS NULL` (histórico) exige o plano
  -- INTEIRO nulo: meio plano sem regime não deriva nada e só confunde a tela.
  SELECT count(*) INTO incoerentes FROM "Proposal"
   WHERE ("billingType" IS NULL AND (
            "startOffsetDays" IS NOT NULL OR "billingDay" IS NOT NULL
            OR "durationMonths" IS NOT NULL OR "installments" IS NOT NULL
            OR "downPaymentPercent" IS NOT NULL OR "downPaymentAmount" IS NOT NULL
            OR "downPaymentOffsetDays" IS NOT NULL))
      OR ("billingType" IS NOT NULL AND "startOffsetDays" IS NULL)
      OR ("billingType" = 'RECURRING' AND ("billingDay" IS NULL
            OR "installments" IS NOT NULL OR "downPaymentPercent" IS NOT NULL
            OR "downPaymentAmount" IS NOT NULL OR "downPaymentOffsetDays" IS NOT NULL))
      OR ("billingType" = 'INSTALLMENTS' AND ("installments" IS NULL
            OR "billingDay" IS NOT NULL OR "durationMonths" IS NOT NULL))
      OR ("billingType" = 'ONE_TIME' AND ("billingDay" IS NOT NULL
            OR "durationMonths" IS NOT NULL OR "installments" IS NOT NULL
            OR "downPaymentPercent" IS NOT NULL OR "downPaymentAmount" IS NOT NULL
            OR "downPaymentOffsetDays" IS NOT NULL));
  IF incoerentes > 0 THEN
    RAISE EXCEPTION 'Há % proposta(s) com plano de cobrança incoerente com o próprio regime.', incoerentes;
  END IF;

  -- Entrada é percentual OU valor. Os dois preenchidos derivariam entradas
  -- diferentes dependendo de qual o código olhar primeiro.
  SELECT count(*) INTO entrada_dupla FROM "Proposal"
   WHERE "downPaymentPercent" IS NOT NULL AND "downPaymentAmount" IS NOT NULL;
  IF entrada_dupla > 0 THEN
    RAISE EXCEPTION 'Há % proposta(s) com entrada em percentual E em valor — só um dos dois pode estar preenchido.', entrada_dupla;
  END IF;
END $$;
```

> A fixture `banco-populado.sql` usa só colunas do `init` e não tem `Contract` nem `Proposal` com plano — nenhuma linha exercita o índice. **Não acrescente colunas novas à fixture** (regra de `apps/api/CLAUDE.md`). A invariante vale por afirmar a *propriedade estrutural* (o índice existe e é único) e as regras de conjunto sobre o conjunto vazio, no molde do bloco de `AccessRecord`, que também afirma estrutura e não dado.

#### O plano como tipo transversal

**Create**: `apps/api/src/shared/billing-plan.ts`

O plano é escrito pelo `ProposalsModule` e lido pelo `FinanceModule`. `shared/` é o lugar dos "utilitários e tipos transversais" (`apps/api/CLAUDE.md`) — é o que evita duplicar a regra ou fazer um módulo importar o interior do outro.

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import type { BillingType, Prisma } from '@prisma/client';

/**
 * Plano de cobrança da proposta: só estrutura e prazos relativos ao aceite.
 * Escrito pelo ProposalsModule, lido pelo FinanceModule (que o converte em
 * campos de Contract + agenda em `finance/application/proposal-plan.ts`).
 *
 * Todos os campos condicionais são `number | null` — nunca `undefined`. O
 * conjunto é gravado em bloco, então "ausente" e "nulo" são a mesma coisa.
 */
export interface BillingPlan {
  billingType: BillingType;
  startOffsetDays: number | null;
  billingDay: number | null;
  durationMonths: number | null;
  downPaymentPercent: number | null;
  downPaymentAmount: number | null;
  downPaymentOffsetDays: number | null;
  installments: number | null;
}

/** Campos do plano como chegam de um DTO (todos opcionais). */
export type BillingPlanFields = Partial<{
  billingType: BillingType;
  startOffsetDays: number;
  billingDay: number;
  durationMonths: number;
  downPaymentPercent: number;
  downPaymentAmount: number;
  downPaymentOffsetDays: number;
  installments: number;
}>;

/**
 * Normaliza os campos de plano de um DTO em um plano, ou `undefined` quando o
 * payload não mexe no plano.
 *
 * O plano é patchado **em bloco, tudo ou nada**: se `billingType` veio, o plano
 * inteiro vem do DTO (campo ausente = null); se não veio, nenhum outro campo de
 * plano é lido. Sem essa regra, um PATCH que troque só o `installments` de um
 * plano RECURRING deixaria o registro incoerente, e o merge campo a campo teria
 * de distinguir "ausente" de "limpar" em sete colunas nullable.
 */
export function planoDoDto(dto: BillingPlanFields): BillingPlan | undefined {
  if (dto.billingType === undefined) return undefined;
  return {
    billingType: dto.billingType,
    startOffsetDays: dto.startOffsetDays ?? null,
    billingDay: dto.billingDay ?? null,
    durationMonths: dto.durationMonths ?? null,
    downPaymentPercent: dto.downPaymentPercent ?? null,
    downPaymentAmount: dto.downPaymentAmount ?? null,
    downPaymentOffsetDays: dto.downPaymentOffsetDays ?? null,
    installments: dto.installments ?? null,
  };
}

/**
 * A linha de `Proposal` como ela sai do Prisma: os dois campos de entrada são
 * `Decimal`, não `number`.
 */
export interface BillingPlanRow {
  billingType: BillingType | null;
  startOffsetDays: number | null;
  billingDay: number | null;
  durationMonths: number | null;
  downPaymentPercent: Prisma.Decimal | null;
  downPaymentAmount: Prisma.Decimal | null;
  downPaymentOffsetDays: number | null;
  installments: number | null;
}

/**
 * Plano gravado → plano de trabalho. `null` quando a linha não tem plano
 * (proposta do histórico).
 *
 * Os `Number()` não são cosméticos: a derivação faz aritmética nesses campos, e
 * `totalCents * decimal` produz `NaN` em silêncio — a entrada derivada viraria
 * zero e as parcelas absorveriam o total inteiro sem nada reclamar.
 *
 * O tipo é estrutural de propósito: o `FinanceModule` chama esta função com o
 * que o `ProposalsService.findOne` devolveu, sem importar `ProposalWithItems`
 * do interior do `ProposalsModule`.
 */
export function planoDaLinha(row: BillingPlanRow): BillingPlan | null {
  if (!row.billingType) return null;
  return {
    billingType: row.billingType,
    startOffsetDays: row.startOffsetDays,
    billingDay: row.billingDay,
    durationMonths: row.durationMonths,
    downPaymentPercent:
      row.downPaymentPercent != null ? Number(row.downPaymentPercent) : null,
    downPaymentAmount:
      row.downPaymentAmount != null ? Number(row.downPaymentAmount) : null,
    downPaymentOffsetDays: row.downPaymentOffsetDays,
    installments: row.installments,
  };
}

/**
 * Coerência do CONJUNTO — o que o DTO não alcança.
 *
 * `UpdateProposalDto` é `PartialType(OmitType(Create))`, e `PartialType` injeta
 * `@IsOptional()` em TODA propriedade. `@IsOptional()` tem precedência sobre os
 * outros validadores quando o valor é nulo/ausente, então um PATCH com
 * `billingType: 'INSTALLMENTS'` e sem `installments` passa pela validação de
 * campo sem reclamar. A trava do conjunto só pode viver aqui.
 *
 * Espelha, do lado do TypeScript, exatamente as regras que `invariantes.sql`
 * afirma do lado do banco.
 */
export function assertPlanoCoerente(plano: BillingPlan): void {
  const erro = (msg: string): never => {
    throw new UnprocessableEntityException(msg);
  };

  if (plano.startOffsetDays == null) {
    erro('Informe em quantos dias após o aceite a cobrança começa.');
  }

  if (plano.billingType === 'RECURRING') {
    if (plano.billingDay == null) {
      erro('Informe o dia de vencimento (1 a 28) do plano recorrente.');
    }
    if (
      plano.installments != null ||
      plano.downPaymentPercent != null ||
      plano.downPaymentAmount != null ||
      plano.downPaymentOffsetDays != null
    ) {
      erro('Plano recorrente não usa entrada nem parcelas.');
    }
    return;
  }

  if (plano.billingType === 'INSTALLMENTS') {
    if (plano.installments == null) erro('Informe a quantidade de parcelas.');
    if (plano.billingDay != null || plano.durationMonths != null) {
      erro('Plano parcelado não usa dia de vencimento nem duração em meses.');
    }
    if (plano.downPaymentPercent != null && plano.downPaymentAmount != null) {
      erro('A entrada é em percentual ou em valor — preencha apenas um dos dois.');
    }
    if (
      plano.downPaymentOffsetDays != null &&
      plano.downPaymentPercent == null &&
      plano.downPaymentAmount == null
    ) {
      erro('Informe a entrada antes do prazo de vencimento dela.');
    }
    return;
  }

  // ONE_TIME — só o offset de vencimento se aplica.
  if (
    plano.billingDay != null ||
    plano.durationMonths != null ||
    plano.installments != null ||
    plano.downPaymentPercent != null ||
    plano.downPaymentAmount != null ||
    plano.downPaymentOffsetDays != null
  ) {
    erro(
      'Pagamento único não usa entrada, parcelas, dia de vencimento nem duração.',
    );
  }
}
```

#### DTOs da proposta

**Modify**: `apps/api/src/modules/proposals/api/dto/create-proposal.dto.ts` — bloco novo no fim da classe, e `BillingType`/`IsEnum`/`Max`/`ValidateIf` nos imports

```ts
  // --- plano de cobrança ---------------------------------------------------
  // Obrigatório na criação (a coluna é nullable só pelo histórico). Campos
  // condicionais no molde de `CreateContractDto`: `@ValidateIf` olhando o
  // `billingType`. A coerência do CONJUNTO é do service — ver
  // `assertPlanoCoerente` em shared/billing-plan.ts e o porquê.
  @IsEnum(BillingType, { message: 'Regime de cobrança inválido.' })
  billingType: BillingType;

  @IsInt({ message: 'Prazo em dias inválido.' })
  @Min(0, { message: 'O prazo não pode ser negativo.' })
  @Max(365, { message: 'O prazo deve ser de no máximo 365 dias.' })
  startOffsetDays: number;

  // RECURRING
  @ValidateIf((o: CreateProposalDto) => o.billingType === 'RECURRING')
  @IsInt({ message: 'Dia de vencimento entre 1 e 28.' })
  @Min(1, { message: 'Dia de vencimento entre 1 e 28.' })
  @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;

  @IsOptional()
  @IsInt({ message: 'Duração em meses inválida.' })
  @Min(1, { message: 'A duração deve ser de pelo menos 1 mês.' })
  @Max(120, { message: 'A duração deve ser de no máximo 120 meses.' })
  durationMonths?: number;

  // INSTALLMENTS
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Entrada em percentual inválida.' })
  @Min(0.01, { message: 'A entrada em percentual deve estar entre 0,01 e 100.' })
  @Max(100, { message: 'A entrada em percentual deve estar entre 0,01 e 100.' })
  downPaymentPercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da entrada inválido.' })
  @Min(0.01, { message: 'Valor da entrada inválido.' })
  downPaymentAmount?: number;

  @IsOptional()
  @IsInt({ message: 'Prazo da entrada inválido.' })
  @Min(0, { message: 'O prazo da entrada não pode ser negativo.' })
  @Max(365, { message: 'O prazo da entrada deve ser de no máximo 365 dias.' })
  downPaymentOffsetDays?: number;

  @ValidateIf((o: CreateProposalDto) => o.billingType === 'INSTALLMENTS')
  @IsInt({ message: 'Informe a quantidade de parcelas.' })
  @Min(1, { message: 'Informe a quantidade de parcelas.' })
  @Max(120, { message: 'No máximo 120 parcelas.' })
  installments?: number;
```

`update-proposal.dto.ts` **não muda**: `PartialType(OmitType(CreateProposalDto, ['clientId', 'dealId']))` herda o plano automaticamente, como opcional — e é isso que o `assertPlanoCoerente` cobre.

#### Serviço da proposta

**Modify**: `apps/api/src/modules/proposals/application/proposals.service.ts`

Import novo:
```ts
import { assertPlanoCoerente, planoDoDto } from '../../../shared/billing-plan';
```

`create` (L70-109) — depois do `computeTotal` (L83):
```ts
    const number = await this.generateNumber();
    const total = computeTotal(dto.items, dto.discount);
    // `billingType` é obrigatório no DTO, então o plano sempre vem na criação.
    const plano = planoDoDto(dto)!;
    assertPlanoCoerente(plano);

    return this.repo.create({
      ownerId,
      number,
      // …campos existentes, sem alteração…
      total,
      ...plano,
      items: {
        // …sem alteração…
      },
    });
```

`update` (L111-167) — antes do `if (dto.items)`:
```ts
    // Plano em bloco: se `billingType` veio, o plano inteiro vem do DTO; se não
    // veio, o patch não toca em nenhuma coluna de plano (ver `planoDoDto`).
    const plano = planoDoDto(dto);
    if (plano) assertPlanoCoerente(plano);
```
e `...(plano ?? {})` nos **dois** caminhos (`updateWithItems` e `update`), junto dos outros spreads condicionais.

`newVersion` (L244-286) — no objeto passado ao `repo.create`, depois de `total: source.total`:
```ts
      total: source.total,
      // O plano é parte da proposta clonada: sem estas linhas a versão nova
      // nasce sem plano e não deriva contrato nenhum.
      billingType: source.billingType,
      startOffsetDays: source.startOffsetDays,
      billingDay: source.billingDay,
      durationMonths: source.durationMonths,
      downPaymentPercent: source.downPaymentPercent,
      downPaymentAmount: source.downPaymentAmount,
      downPaymentOffsetDays: source.downPaymentOffsetDays,
      installments: source.installments,
```

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — `POST /proposals` (L631) e `PATCH /proposals/:id` (L655)

`POST /proposals`:
- **Body**: acrescentar ao objeto `billingType: 'RECURRING' | 'INSTALLMENTS' | 'ONE_TIME'` e `startOffsetDays: number (0–365)` como **obrigatórios**, mais os condicionais por regime: RECURRING `{ billingDay (1–28), durationMonths? }`; INSTALLMENTS `{ installments (1–120), downPaymentPercent? | downPaymentAmount?, downPaymentOffsetDays? }`; ONE_TIME `{}`.
- **Propósito**: acrescentar a frase "Grava também o **plano de cobrança** (estrutura e prazos em dias relativos ao aceite) que deriva o contrato; nenhum valor em dinheiro vive no plano."
- **Erros**: acrescentar `422` com as mensagens de `assertPlanoCoerente`.

`PATCH /proposals/:id`:
- **Body**: acrescentar que os campos de plano são aceitos e que **o plano é patchado em bloco**: enviar `billingType` substitui o plano inteiro (campo ausente vira nulo); omitir `billingType` deixa o plano intacto.
- **Erros**: acrescentar os `422` de coerência.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api prisma generate` — o client reflete as 8 colunas e o `@unique`
- [x] `pnpm --filter api build` — sem erro de tipo
- [x] `pnpm --filter api lint`
- [x] `pnpm --filter api test -- billing-plan` — `src/shared/billing-plan.spec.ts` passa
- [x] `pnpm --filter api test -- proposals.service` — plano persistido no create, validado no update, clonado no newVersion
- [x] `docker compose up -d && DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — verde, incluindo o bloco novo de invariantes
- [x] Portão reprovando de propósito: inserir dois `Contract` com o mesmo `proposalId` antes da migration e confirmar que o `RAISE EXCEPTION` nomeia a proposta

#### Manual Verification
- [ ] `POST /proposals` sem `billingType` responde `400` com mensagem em pt-BR
- [ ] `POST /proposals` com `billingType: 'RECURRING'` e sem `billingDay` responde `400`
- [ ] `PATCH /proposals/:id` com `billingType: 'INSTALLMENTS'` e sem `installments` responde `422 Informe a quantidade de parcelas.` (é o caso que o `PartialType` deixaria passar)
- [ ] `PATCH /proposals/:id` mandando só `scope` não zera o plano gravado
- [ ] `POST /proposals/:id/new-version` devolve a versão nova com o plano igual ao da origem

**⏸ PAUSE**: Após a verificação automatizada passar, parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Phase 2: Derivação e rotas de geração

### Goal

O `FinanceModule` deriva contrato e agenda de uma proposta aceita, com posse, status, cadeia e idempotência validados, e expõe isso em três rotas.

### Changes

#### Aritmética pura

**Modify**: `apps/api/src/modules/finance/application/schedule.ts`

Duas funções novas, depois de `addMonths` (L20):
```ts
/**
 * Soma n dias em UTC. Os offsets do plano de cobrança são "dias após o
 * aceite"; somar em hora local deslocaria o dia em fuso negativo, pela mesma
 * razão documentada em `addMonths`.
 */
export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * Trunca para meia-noite UTC.
 *
 * A âncora da derivação é `Proposal.decidedAt`, um instante COM hora (gravado
 * por `new Date()` no aceite), enquanto todo vencimento do financeiro é
 * meia-noite UTC (vem de string ISO "AAAA-MM-DD" no DTO). Sem truncar, a
 * agenda derivada nasceria com a hora do clique dentro dela, e o
 * `billingDatesInWindow` do cron compararia um cursor de meia-noite com um
 * `startDate` das 14h32 — perdendo a primeira mensalidade do contrato.
 */
export function aoDiaUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
```

E `buildInstallmentSchedule` (L27-50) ganha um campo opcional — a assinatura atual continua valendo para o caminho manual:
```ts
export function buildInstallmentSchedule(input: {
  downPayment?: number | null;
  downPaymentDueDate?: Date | null;
  installments: number;
  installmentAmount: number;
  /**
   * Valor da ÚLTIMA parcela quando ele difere das demais. Só a derivação usa:
   * `(total − entrada) / N` quase nunca é redondo, e a sobra de centavos vai
   * toda para a última — as N−1 primeiras ficam no valor redondo que a proposta
   * anunciou. Ausente → todas iguais (caminho manual, em que o usuário digitou
   * `installmentAmount` e a soma é o que ele quis).
   */
  lastInstallmentAmount?: number | null;
  firstInstallmentDueDate: Date;
}): ScheduledCharge[] {
  // …entrada sem alteração…
  for (let i = 1; i <= input.installments; i++) {
    const valor =
      i === input.installments && input.lastInstallmentAmount != null
        ? input.lastInstallmentAmount
        : input.installmentAmount;
    charges.push({
      description: `Parcela ${i}/${input.installments}`,
      amount: fromCents(toCents(valor)),
      dueDate: addMonths(input.firstInstallmentDueDate, i - 1),
    });
  }
  return charges;
}
```

**Create**: `apps/api/src/modules/finance/application/proposal-plan.ts`

```ts
import { fromCents, toCents } from './money';
import {
  addDays,
  addMonths,
  aoDiaUtc,
  buildInstallmentSchedule,
  buildOneTimeSchedule,
  type ScheduledCharge,
} from './schedule';
import type { BillingPlan } from '../../../shared/billing-plan';

/** Campos do Contract + a agenda, prontos para o repositório. */
export interface ContratoDerivado {
  billingType: BillingPlan['billingType'];
  monthlyAmount: number | null;
  billingDay: number | null;
  startDate: Date | null;
  endDate: Date | null;
  downPayment: number | null;
  installments: number | null;
  installmentAmount: number | null;
  cobrancas: ScheduledCharge[];
}

/**
 * Rateio da parcela: (total − entrada) em N partes, com a sobra de centavos
 * TODA na última. Em centavos inteiros para não herdar erro de float — mesmo
 * molde de `computeTotal` (proposals/application/money.ts).
 *
 * Ex.: total 11.480,00, entrada 3.000,00, 3 parcelas → 2.826,66 / 2.826,66 /
 * 2.826,68. A soma fecha exatamente com o total, que é a propriedade que o
 * `buildInstallmentSchedule` garantia por construção e que a derivação
 * precisa reconstruir.
 */
export function ratearParcelas(
  totalCents: number,
  entradaCents: number,
  installments: number,
): { parcelaCents: number; ultimaCents: number } {
  const restante = Math.max(0, totalCents - entradaCents);
  const parcelaCents = Math.floor(restante / installments);
  const ultimaCents = parcelaCents + (restante - parcelaCents * installments);
  return { parcelaCents, ultimaCents };
}

/** Entrada em centavos: percentual sobre o total, ou o valor literal. Nunca acima do total. */
export function entradaEmCentavos(
  plano: BillingPlan,
  totalCents: number,
): number {
  if (plano.downPaymentPercent != null) {
    return Math.min(
      totalCents,
      Math.round((totalCents * plano.downPaymentPercent) / 100),
    );
  }
  if (plano.downPaymentAmount != null) {
    return Math.min(totalCents, toCents(plano.downPaymentAmount));
  }
  return 0;
}

/**
 * Plano + total + âncora → campos do contrato e agenda de cobranças.
 *
 * Função pura: zero I/O, zero Prisma, zero `new Date()` sem argumento — é o que
 * a torna testável e determinística (molde de `schedule.ts`). A âncora é
 * `Proposal.decidedAt`, truncada ao dia UTC.
 *
 * Assume plano coerente (`assertPlanoCoerente` já rodou na fronteira) — daí os
 * `!`, no mesmo padrão de `ContractsService.createByBillingType`.
 */
export function derivarContrato(input: {
  plano: BillingPlan;
  total: number;
  ancora: Date;
}): ContratoDerivado {
  const { plano, total } = input;
  const aceite = aoDiaUtc(input.ancora);
  const inicio = addDays(aceite, plano.startOffsetDays!);
  const vazio = {
    monthlyAmount: null,
    billingDay: null,
    startDate: null,
    endDate: null,
    downPayment: null,
    installments: null,
    installmentAmount: null,
  };

  if (plano.billingType === 'RECURRING') {
    return {
      ...vazio,
      billingType: 'RECURRING',
      // `total` de proposta recorrente É a mensalidade (ver schema.prisma).
      monthlyAmount: total,
      billingDay: plano.billingDay!,
      startDate: inicio,
      endDate: plano.durationMonths
        ? addMonths(inicio, plano.durationMonths)
        : null,
      // Nenhuma cobrança na criação: o cron gera as mensalidades.
      cobrancas: [],
    };
  }

  if (plano.billingType === 'ONE_TIME') {
    return {
      ...vazio,
      billingType: 'ONE_TIME',
      cobrancas: buildOneTimeSchedule(total, inicio),
    };
  }

  const totalCents = toCents(total);
  const entradaCents = entradaEmCentavos(plano, totalCents);
  const { parcelaCents, ultimaCents } = ratearParcelas(
    totalCents,
    entradaCents,
    plano.installments!,
  );
  const entrada = entradaCents > 0 ? fromCents(entradaCents) : null;
  return {
    ...vazio,
    billingType: 'INSTALLMENTS',
    downPayment: entrada,
    installments: plano.installments!,
    installmentAmount: fromCents(parcelaCents),
    cobrancas: buildInstallmentSchedule({
      downPayment: entrada,
      downPaymentDueDate: addDays(aceite, plano.downPaymentOffsetDays ?? 0),
      installments: plano.installments!,
      installmentAmount: fromCents(parcelaCents),
      lastInstallmentAmount: fromCents(ultimaCents),
      firstInstallmentDueDate: inicio,
    }),
  };
}
```

#### Repositório

**Modify**: `apps/api/src/modules/finance/domain/contract.repository.ts` — na interface `ContractRepository`

```ts
  /**
   * Contratos de qualquer uma das propostas informadas. Recebe uma LISTA
   * porque a pergunta do negócio é sobre a cadeia de versões (mesmo `number`),
   * não sobre uma linha: duas versões da mesma proposta não podem gerar dois
   * contratos.
   */
  findByProposalIds(proposalIds: string[]): Promise<ContractWithPayments[]>;
```

**Modify**: `apps/api/src/modules/finance/infra/prisma-contract.repository.ts`

```ts
  findByProposalIds(proposalIds: string[]) {
    return this.prisma.db.contract.findMany({
      where: { proposalId: { in: proposalIds } },
      include: withPayments,
      orderBy: { createdAt: 'desc' },
    });
  }
```

E o `include` compartilhado ganha a proposta de origem — é o que a ficha do contrato renderiza na Fase 4:
```ts
const withPayments = {
  payments: { orderBy: { dueDate: 'asc' } },
  client: { select: { id: true, name: true } },
  // A ficha do contrato aponta para a proposta de origem: `proposalId` sozinho
  // não dá nome nem versão para o link.
  proposal: { select: { id: true, number: true, version: true } },
} as const;
```

#### DTO da derivação

**Create**: `apps/api/src/modules/finance/api/dto/derive-contract-from-proposal.dto.ts`

```ts
import { Type } from 'class-transformer';
import { BillingType } from '@prisma/client';
import {
  IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min,
  MinLength, ValidateNested,
} from 'class-validator';

/**
 * Plano enviado pela tela de conferência. Duplica os campos de plano de
 * `CreateProposalDto` de propósito: um módulo não importa o interior de outro
 * (`apps/api/CLAUDE.md`), e é a mesma razão pela qual
 * `finance/application/money.ts` é uma cópia do de `proposals`. O que NÃO é
 * duplicado é a regra: `assertPlanoCoerente` vive em `shared/billing-plan.ts`
 * e é chamada pelos dois lados.
 *
 * Todos opcionais: o `@ValidateIf` por regime não cabe aqui (o plano é um
 * objeto aninhado e o regime vive nele), então a coerência é 100% do
 * `assertPlanoCoerente` no service.
 */
export class BillingPlanDto {
  @IsEnum(BillingType, { message: 'Regime de cobrança inválido.' })
  billingType: BillingType;

  @IsInt({ message: 'Prazo em dias inválido.' })
  @Min(0, { message: 'O prazo não pode ser negativo.' })
  @Max(365, { message: 'O prazo deve ser de no máximo 365 dias.' })
  startOffsetDays: number;

  @IsOptional() @IsInt({ message: 'Dia de vencimento entre 1 e 28.' })
  @Min(1, { message: 'Dia de vencimento entre 1 e 28.' })
  @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;

  @IsOptional() @IsInt({ message: 'Duração em meses inválida.' })
  @Min(1, { message: 'A duração deve ser de pelo menos 1 mês.' })
  @Max(120, { message: 'A duração deve ser de no máximo 120 meses.' })
  durationMonths?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Entrada em percentual inválida.' })
  @Min(0.01, { message: 'A entrada em percentual deve estar entre 0,01 e 100.' })
  @Max(100, { message: 'A entrada em percentual deve estar entre 0,01 e 100.' })
  downPaymentPercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da entrada inválido.' })
  @Min(0.01, { message: 'Valor da entrada inválido.' })
  downPaymentAmount?: number;

  @IsOptional() @IsInt({ message: 'Prazo da entrada inválido.' })
  @Min(0, { message: 'O prazo da entrada não pode ser negativo.' })
  @Max(365, { message: 'O prazo da entrada deve ser de no máximo 365 dias.' })
  downPaymentOffsetDays?: number;

  @IsOptional() @IsInt({ message: 'Informe a quantidade de parcelas.' })
  @Min(1, { message: 'Informe a quantidade de parcelas.' })
  @Max(120, { message: 'No máximo 120 parcelas.' })
  installments?: number;
}

/**
 * Corpo das duas rotas de derivação. Tudo opcional: body vazio = "use o plano
 * gravado na proposta e a descrição padrão".
 *
 * O que se envia é o PLANO, não os campos do contrato. Assim o rateio de
 * centavos e o valor da última parcela nunca atravessam a rede — a matemática
 * de dinheiro vive só no backend, como o `total` da proposta.
 */
export class DeriveContractFromProposalDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Descrição obrigatória.' })
  description?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingPlanDto)
  plano?: BillingPlanDto;
}
```

#### Fronteira do módulo

**Modify**: `apps/api/src/modules/finance/finance.module.ts`

```ts
import { ProposalsModule } from '../proposals/proposals.module';
// …
@Module({
  // ProposalsModule entra para a derivação de contrato validar posse e status
  // do `proposalId` — a limitação registrada em specs/plans/2026-07-23-fase-5.
  // A direção é acíclica: `proposals` não conhece `finance`.
  imports: [ClientsModule, DataModule, ProposalsModule],
```

#### Serviço

**Modify**: `apps/api/src/modules/finance/application/contracts.service.ts`

Imports e construtor:
```ts
import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProposalsService } from '../../proposals/application/proposals.service';
import {
  assertPlanoCoerente, planoDaLinha, planoDoDto,
  type BillingPlan, type BillingPlanRow,
} from '../../../shared/billing-plan';
import { derivarContrato, entradaEmCentavos, type ContratoDerivado } from './proposal-plan';
import { toCents } from './money';
import type { DeriveContractFromProposalDto } from '../api/dto/derive-contract-from-proposal.dto';
// …
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly repo: ContractRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
    private readonly proposals: ProposalsService,
  ) {}
```

Reescrever o comentário de `create` (L103-105), que fica desatualizado:
```ts
    await this.clients.findOne(ownerId, dto.clientId); // valida posse do cliente
    // `proposalId` informado aqui NÃO é validado: este é o caminho manual, e a
    // geração a partir de proposta tem rota própria (`createFromProposal`), que
    // valida posse, status e cadeia. `projectId` segue sem validação cruzada —
    // o FinanceModule não importa ProjectsModule.
```

Três métodos novos, depois de `create`/`createByBillingType`:

```ts
  /**
   * Deriva o contrato de uma proposta sem gravar nada — é a tela de
   * conferência. Cada ajuste no plano refaz esta chamada, então a matemática de
   * dinheiro (rateio, sobra de centavos) vive só aqui e nunca no frontend.
   *
   * É POST porque recebe corpo (o plano em edição), não porque escreve: nada
   * nesta rota toca o banco além das leituras de posse.
   */
  async previewFromProposal(
    ownerId: string,
    proposalId: string,
    dto: DeriveContractFromProposalDto,
  ): Promise<PreviaDeContrato> {
    const proposta = await this.proposals.findOne(ownerId, proposalId); // 404 se não for do dono
    const plano = this.planoParaDerivacao(proposta, dto);
    // CORREÇÃO ao spec: a prévia não recusa ESTADO (status, ausência de plano,
    // contrato já existente) — isso ela RELATA, e a tela decide o que
    // habilitar. Mas plano INCOERENTE ela recusa com 422, como o ENDPOINTS.md
    // desta mesma fase já documentava e como a Fase 4 pressupõe ao falar do
    // erro inline. Sem isso a derivação ignora em silêncio o campo que não
    // pertence ao regime e devolve agenda que não corresponde ao digitado.
    if (plano) assertPlanoCoerente(plano);
    const existentes = await this.contratosDaCadeia(ownerId, proposalId);
    return {
      proposta: {
        id: proposta.id,
        number: proposta.number,
        version: proposta.version,
        status: proposta.status,
        total: proposta.total,
        decidedAt: proposta.decidedAt,
        clientId: proposta.clientId,
        client: proposta.client,
      },
      plano,
      derivado:
        plano && proposta.decidedAt
          ? derivarContrato({
              plano,
              total: Number(proposta.total),
              ancora: proposta.decidedAt,
            })
          : null,
      descricaoSugerida: dto.description ?? `Contrato — ${proposta.number}`,
      contratosExistentes: existentes.map((c) => ({
        id: c.id,
        description: c.description,
        status: c.status,
        proposalId: c.proposalId,
      })),
    };
  }

  /**
   * Gera o contrato a partir de uma proposta aceita, com a agenda derivada do
   * plano. Um clique = um contrato + N cobranças + um registro de auditoria.
   */
  async createFromProposal(
    ownerId: string,
    proposalId: string,
    dto: DeriveContractFromProposalDto,
  ): Promise<ContractWithPayments> {
    const proposta = await this.proposals.findOne(ownerId, proposalId); // 404 se não for do dono
    if (proposta.status !== 'ACCEPTED') {
      throw new UnprocessableEntityException(
        'Só proposta aceita gera contrato.',
      );
    }
    if (!proposta.decidedAt) {
      // Defensivo: `accept` grava `decidedAt` junto do status, e ACCEPTED é
      // terminal. Sem âncora não há como converter offset em data.
      throw new UnprocessableEntityException(
        'A proposta não tem data de aceite — não há âncora para os prazos.',
      );
    }
    const plano = this.planoParaDerivacao(proposta, dto);
    if (!plano) {
      throw new UnprocessableEntityException(
        'Esta proposta não tem plano de cobrança. Preencha o plano na tela de geração.',
      );
    }
    assertPlanoCoerente(plano);

    // Um contrato por CADEIA de versões, não por linha: o @unique cobre a
    // linha, mas duas versões da mesma proposta são linhas distintas.
    const existentes = await this.contratosDaCadeia(ownerId, proposalId);
    if (existentes.length > 0) {
      const [c] = existentes;
      throw new ConflictException(
        `A proposta ${proposta.number} já gerou o contrato “${c.description}”. Cancele-o antes de gerar outro.`,
      );
    }

    const derivado = derivarContrato({
      plano,
      total: Number(proposta.total),
      ancora: proposta.decidedAt,
    });
    if (
      derivado.billingType === 'INSTALLMENTS' &&
      derivado.installmentAmount === 0
    ) {
      // Entrada cobrindo o total geraria N cobranças de R$ 0,00.
      throw new UnprocessableEntityException(
        'A entrada cobre o total da proposta: não sobra valor para parcelar.',
      );
    }

    const criado = await this.gravarDerivado(ownerId, proposta, dto, derivado);
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: criado.id,
      entityLabel: criado.description,
      action: 'CRIAR',
      // Um registro só: as N cobranças são consequência de uma intenção
      // (molde de `cancel`). `AuditAction` não tem "GERAR" — CRIAR com a
      // origem no `extra` cabe sem migration de enum.
      extra: {
        cobrancasGeradas: criado.payments.length,
        derivadoDeProposta: true,
        propostaId: proposta.id,
        propostaNumero: proposta.number,
        propostaVersao: proposta.version,
      },
    });
    this.logger.log({
      evento: 'contrato.derivado_de_proposta',
      msg: 'Contrato gerado a partir do plano de cobrança da proposta.',
      contratoId: criado.id,
      propostaId: proposta.id,
      regime: derivado.billingType,
      cobrancas: criado.payments.length,
    });
    return criado;
  }

  /** Contratos gerados por qualquer versão da cadeia da proposta informada. */
  async listByProposal(
    ownerId: string,
    proposalId: string,
  ): Promise<ContractWithPayments[]> {
    await this.proposals.findOne(ownerId, proposalId); // posse (404)
    return this.contratosDaCadeia(ownerId, proposalId);
  }
```

E os privados:

```ts
  /**
   * Plano do body (tela de conferência) ou o gravado na proposta; null quando
   * não há nenhum (proposta do histórico).
   *
   * `planoDoDto` devolve `undefined` quando `billingType` não veio — no body
   * isso significa "use o que está gravado".
   */
  private planoParaDerivacao(
    proposta: BillingPlanRow,
    dto: DeriveContractFromProposalDto,
  ): BillingPlan | null {
    return planoDoDto(dto.plano ?? {}) ?? planoDaLinha(proposta);
  }

  private async contratosDaCadeia(ownerId: string, proposalId: string) {
    const cadeia = await this.proposals.versions(ownerId, proposalId);
    return this.repo.findByProposalIds(cadeia.map((p) => p.id));
  }

  /**
   * Grava contrato + cobranças. O `@unique` em `proposalId` é a última linha de
   * defesa da idempotência: dois cliques simultâneos passam os dois pela
   * checagem de cadeia (nenhum contrato existia quando cada um consultou) e é o
   * banco que derruba o segundo. P2002 traduzido para a mesma mensagem do 409.
   */
  private async gravarDerivado(
    ownerId: string,
    proposta: { id: string; clientId: string; number: string },
    dto: DeriveContractFromProposalDto,
    derivado: ContratoDerivado,
  ): Promise<ContractWithPayments> {
    try {
      return await this.repo.create({
        ownerId,
        clientId: proposta.clientId,
        projectId: dto.projectId ?? null,
        proposalId: proposta.id,
        description: dto.description ?? `Contrato — ${proposta.number}`,
        billingType: derivado.billingType,
        status: 'ACTIVE',
        monthlyAmount: derivado.monthlyAmount,
        billingDay: derivado.billingDay,
        startDate: derivado.startDate,
        endDate: derivado.endDate,
        downPayment: derivado.downPayment,
        installments: derivado.installments,
        installmentAmount: derivado.installmentAmount,
        payments: {
          create: derivado.cobrancas.map((c) => ({
            ownerId,
            description: c.description,
            amount: c.amount,
            dueDate: c.dueDate,
          })),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A proposta ${proposta.number} já gerou um contrato.`,
        );
      }
      throw e;
    }
  }
```

**Create**: `apps/api/src/modules/finance/application/contract-preview.ts` — o tipo de retorno da prévia (mantém o service enxuto)

```ts
import type { ContratoDerivado } from './proposal-plan';
import type { BillingPlan } from '../../../shared/billing-plan';

/**
 * O que a tela de conferência precisa para se desenhar inteira numa chamada:
 * a proposta (para o cabeçalho e o total), o plano em vigor (para preencher os
 * campos), o derivado (para a agenda) e os contratos que já existem na cadeia
 * (para desabilitar o botão em vez de deixar o usuário levar um 409).
 *
 * `derivado` é null quando a proposta não tem plano (histórico) — a tela abre
 * com os campos vazios e o usuário preenche à mão.
 */
export interface PreviaDeContrato {
  proposta: {
    id: string;
    number: string;
    version: number;
    status: string;
    total: unknown; // Decimal → string no JSON
    decidedAt: Date | null;
    clientId: string;
    client: { id: string; name: string };
  };
  plano: BillingPlan | null;
  derivado: ContratoDerivado | null;
  descricaoSugerida: string;
  contratosExistentes: {
    id: string;
    description: string;
    status: string;
    proposalId: string | null;
  }[];
}
```

#### Controller

**Modify**: `apps/api/src/modules/finance/api/contracts.controller.ts` — as três rotas logo depois de `GET export` (L40-46), **antes** de qualquer `:id`

```ts
  // Rotas literais antes das de `:id`, no mesmo cuidado de `GET /contracts/export`
  // (comentário em L38): `from-proposal`/`by-proposal` não colidem com as rotas
  // de hoje, mas a ordem é a convenção do arquivo e protege de colisão futura.

  @RequirePermission('financeiro:gerenciar')
  @Post('from-proposal/:proposalId/preview')
  previewFromProposal(
    @CurrentOwnerId() ownerId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: DeriveContractFromProposalDto,
  ) {
    return this.contracts.previewFromProposal(ownerId, proposalId, dto);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post('from-proposal/:proposalId')
  createFromProposal(
    @CurrentOwnerId() ownerId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: DeriveContractFromProposalDto,
  ) {
    return this.contracts.createFromProposal(ownerId, proposalId, dto);
  }

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get('by-proposal/:proposalId')
  listByProposal(
    @CurrentOwnerId() ownerId: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.contracts.listByProposal(ownerId, proposalId);
  }
```

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md` — três blocos novos na seção `## Contracts`, depois de `GET /contracts/export`, no formato fixo (Propósito / Auth / Body / Resposta / Erros / Handler):

- `POST /contracts/from-proposal/:proposalId/preview` — Propósito: derivar sem gravar, para a tela de conferência; explicitar que **não escreve nada** e que é POST por receber corpo. Body: `{ description?, projectId?, plano? }`. Resposta: `200 PreviaDeContrato`. Erros: `400`, `404 Proposta não encontrada.`, `422` (coerência do plano), `401`, `403`.
- `POST /contracts/from-proposal/:proposalId` — Propósito: gerar o contrato e a agenda a partir do plano, ancorando em `decidedAt`; um contrato por cadeia de versões. Resposta: `201 Contract`. Erros: `400`, `404 Proposta não encontrada.`, `409 A proposta … já gerou o contrato “…”. Cancele-o antes de gerar outro.`, `422 Só proposta aceita gera contrato.` / `Esta proposta não tem plano de cobrança…` / `A entrada cobre o total da proposta…` / coerência do plano, `401`, `403`.
- `GET /contracts/by-proposal/:proposalId` — Propósito: contratos gerados por qualquer versão da cadeia. Resposta: `200 Contract[]`. Erros: `404 Proposta não encontrada.`, `401`, `403`.

Acrescentar também a `proposal: { id, number, version }` na descrição da resposta de `GET /contracts` e `GET /contracts/:id`.

**Modify**: `docs/observabilidade.md` — linha nova na tabela "Eventos que a API emite" (L74+), em ordem próxima aos demais de financeiro:

```
| `contrato.derivado_de_proposta` | contrato gerado a partir do plano de cobrança de uma proposta aceita | `info` |
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build`
- [x] `pnpm --filter api lint`
- [x] `pnpm --filter api test -- schedule` — `addDays`/`aoDiaUtc`/`lastInstallmentAmount` cobertos; os testes existentes continuam passando (assinatura retrocompatível)
- [x] `pnpm --filter api test -- proposal-plan` — os três regimes, o rateio e a âncora
- [x] `pnpm --filter api test -- contracts.service` — status, plano ausente, cadeia (409), P2002 (409), auditoria agregada
- [x] `pnpm --filter api test` — suíte inteira verde
- [x] `apps/api/scripts/validar-migrations-com-dados.sh` continua verde

#### Manual Verification
- [ ] `POST /contracts/from-proposal/:id/preview` de proposta `INSTALLMENTS` com total 11.480,00, entrada 30% e 3 parcelas devolve entrada 3.444,00 e parcelas 2.678,66 / 2.678,66 / 2.678,68, **somando exatamente 11.480,00**
- [ ] A mesma chamada com `plano` no body (entrada de R$ 3.000,00 em valor) recalcula e continua fechando no total
- [ ] `POST /contracts/from-proposal/:id` de proposta `SENT` responde `422 Só proposta aceita gera contrato.`
- [ ] Chamar a rota duas vezes na mesma proposta: a segunda responde `409` nomeando o contrato
- [ ] Proposta de outro owner responde `404 Proposta não encontrada.` (não `403`)
- [ ] Contrato `RECURRING` derivado nasce com zero `Payment`, `startDate` em meia-noite UTC e `endDate` = início + `durationMonths`
- [ ] A trilha de auditoria mostra **um** registro `CRIAR` em `CONTRACT` com `propostaNumero` no `extra`
- [ ] O log traz uma linha JSON com `evento: "contrato.derivado_de_proposta"` e nenhum dado sensível

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 3.

---

## Phase 3: Plano no formulário e na ficha da proposta

### Goal

Quem cria uma proposta declara o plano de cobrança, e quem abre a ficha o lê em uma frase, com o total marcado como mensalidade nos planos recorrentes.

### Changes

#### Tipos

**Modify**: `apps/web/src/features/propostas/api/types.ts`

```ts
/**
 * Declarado aqui, não importado de `features/financeiro`: uma feature não
 * importa o interior de outra (`apps/web/CLAUDE.md`). Os RÓTULOS não são
 * duplicados — vêm de `BILLING_TYPE_LABELS` em `@/lib/labels`.
 */
export type BillingType = 'RECURRING' | 'INSTALLMENTS' | 'ONE_TIME';
```
e, em `Proposal` (flat, como a API devolve):
```ts
  total: string; // em plano RECURRING é o valor MENSAL
  // --- plano de cobrança ---
  billingType?: BillingType | null;
  startOffsetDays?: number | null;
  billingDay?: number | null;
  durationMonths?: number | null;
  downPaymentPercent?: string | null; // Decimal → string
  downPaymentAmount?: string | null;
  downPaymentOffsetDays?: number | null;
  installments?: number | null;
```
e, em `CreateProposalBody`:
```ts
  billingType: BillingType;
  startOffsetDays: number;
  billingDay?: number;
  durationMonths?: number;
  downPaymentPercent?: number;
  downPaymentAmount?: number;
  downPaymentOffsetDays?: number;
  installments?: number;
```
`UpdateProposalBody` continua sendo o `Partial<Omit<…>>` e herda.

#### Formulário

**Modify**: `apps/web/src/features/propostas/ProposalFormDialog.tsx`

Schema (L29-46) — campos novos e `superRefine`, no molde de [ContratoFormDialog.tsx:58-117](apps/web/src/features/financeiro/ContratoFormDialog.tsx#L58-L117):
```ts
const schema = z
  .object({
    // …campos existentes…
    // Plano de cobrança. `billingType` e `startOffsetDays` sem `.optional()`
    // → asterisco obrigatório na label (regra de apps/web/CLAUDE.md).
    billingType: z.enum(['RECURRING', 'INSTALLMENTS', 'ONE_TIME']),
    startOffsetDays: z.number().min(0, 'O prazo não pode ser negativo.').max(365),
    billingDay: z.number().optional(),
    durationMonths: z.number().optional(),
    /** Como a entrada é expressa — é UI, não vai no body. */
    tipoDeEntrada: z.enum(['NENHUMA', 'PERCENTUAL', 'VALOR']),
    downPaymentPercent: z.number().optional(),
    downPaymentAmount: z.number().optional(),
    downPaymentOffsetDays: z.number().optional(),
    installments: z.number().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.billingType === 'RECURRING') {
      if (!v.billingDay || v.billingDay < 1 || v.billingDay > 28) {
        ctx.addIssue({ code: 'custom', path: ['billingDay'], message: 'Dia de vencimento entre 1 e 28.' });
      }
    }
    if (v.billingType === 'INSTALLMENTS') {
      if (!v.installments || v.installments < 1) {
        ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Informe a quantidade de parcelas.' });
      }
      if (v.tipoDeEntrada === 'PERCENTUAL' && !v.downPaymentPercent) {
        ctx.addIssue({ code: 'custom', path: ['downPaymentPercent'], message: 'Informe o percentual da entrada.' });
      }
      if (v.tipoDeEntrada === 'VALOR' && !v.downPaymentAmount) {
        ctx.addIssue({ code: 'custom', path: ['downPaymentAmount'], message: 'Informe o valor da entrada.' });
      }
    }
  });
```

`EMPTY` (L50-59) e `toValues` (L61-76) ganham o plano. `toValues` deriva `tipoDeEntrada` do que está gravado:
```ts
    billingType: proposal.billingType ?? 'ONE_TIME',
    startOffsetDays: proposal.startOffsetDays ?? 0,
    billingDay: proposal.billingDay ?? undefined,
    durationMonths: proposal.durationMonths ?? undefined,
    tipoDeEntrada:
      proposal.downPaymentPercent != null ? 'PERCENTUAL'
      : proposal.downPaymentAmount != null ? 'VALOR'
      : 'NENHUMA',
    downPaymentPercent: proposal.downPaymentPercent != null ? Number(proposal.downPaymentPercent) : undefined,
    downPaymentAmount: proposal.downPaymentAmount != null ? Number(proposal.downPaymentAmount) : undefined,
    downPaymentOffsetDays: proposal.downPaymentOffsetDays ?? undefined,
    installments: proposal.installments ?? undefined,
```

`onSubmit` (L142-152) — o body só leva os campos do regime, e `tipoDeEntrada` decide qual coluna de entrada vai:
```ts
    const body = {
      // …campos existentes…
      billingType: v.billingType,
      startOffsetDays: v.startOffsetDays,
      // Só os campos do regime escolhido: mandar os outros derrubaria em 422
      // no `assertPlanoCoerente` ("plano recorrente não usa entrada…").
      ...(v.billingType === 'RECURRING'
        ? { billingDay: v.billingDay, durationMonths: v.durationMonths || undefined }
        : {}),
      ...(v.billingType === 'INSTALLMENTS'
        ? {
            installments: v.installments,
            ...(v.tipoDeEntrada === 'PERCENTUAL' ? { downPaymentPercent: v.downPaymentPercent } : {}),
            ...(v.tipoDeEntrada === 'VALOR' ? { downPaymentAmount: v.downPaymentAmount } : {}),
            ...(v.tipoDeEntrada !== 'NENHUMA' ? { downPaymentOffsetDays: v.downPaymentOffsetDays ?? 0 } : {}),
          }
        : {}),
    };
```

Campos na coluna direita (L204-288), acima de `paymentTerms` — que ganha um `FieldDescription`/hint dizendo que é observação complementar, não a estrutura:

| Campo | Controle | Condição |
|---|---|---|
| Regime de cobrança | `Select` com `BILLING_TYPE_LABELS` (`FieldLabel required`) | sempre |
| Começa em (dias após o aceite) | `Input type="number"` min 0 max 365 (`required`) | sempre |
| Dia de vencimento (1–28) | `Input type="number"` (`required`) | `RECURRING` |
| Duração (meses) | `Input type="number"`, placeholder "Em branco = indeterminado" | `RECURRING` |
| Entrada | `Select` `NENHUMA | PERCENTUAL | VALOR` (`required`) | `INSTALLMENTS` |
| Entrada (%) | `Input type="number"` step 0.01 (`required`) | `INSTALLMENTS` + `PERCENTUAL` |
| Valor da entrada | `MoneyInput` (`required`) | `INSTALLMENTS` + `VALOR` |
| Vencimento da entrada (dias após o aceite) | `Input type="number"` | `INSTALLMENTS` + entrada ≠ `NENHUMA` |
| Quantidade de parcelas | `Input type="number"` (`required`) | `INSTALLMENTS` |

Regras que valem sem exceção nesses campos: `Select` e `MoneyInput` do design system (nunca `<select>` nativo), `FieldLabel required` para todo campo que o Zod não marca `.optional()`, `FieldError` abaixo de cada um, textos em pt-BR.

#### Leitura na ficha e na listagem

**Create**: `apps/web/src/features/propostas/lib/billing-plan-format.ts`

```ts
import { translateBillingType } from '@/lib/labels';
import type { Proposal } from '../api/types';
import { formatMoney } from './proposal-format';

/**
 * O plano em uma frase, do jeito que se fala numa reunião: "Parcelado —
 * entrada de 30% em 5 dias + 8 parcelas a partir de 30 dias do aceite".
 *
 * Uma frase e não uma grade de oito campos: o plano é uma coisa só, e a ficha
 * já tem grade demais. A grade fica na tela de conferência, onde se edita.
 */
export function describeBillingPlan(proposal: Proposal): string | null {
  if (!proposal.billingType) return null;
  const regime = translateBillingType(proposal.billingType);
  const inicio = emDias(proposal.startOffsetDays ?? 0);

  if (proposal.billingType === 'RECURRING') {
    const duracao = proposal.durationMonths
      ? `por ${proposal.durationMonths} ${proposal.durationMonths === 1 ? 'mês' : 'meses'}`
      : 'por tempo indeterminado';
    return `${regime} — vencimento todo dia ${proposal.billingDay}, começando ${inicio}, ${duracao}`;
  }
  if (proposal.billingType === 'ONE_TIME') {
    return `${regime} — vencimento ${inicio}`;
  }
  const entrada =
    proposal.downPaymentPercent != null
      ? `entrada de ${Number(proposal.downPaymentPercent)}%`
      : proposal.downPaymentAmount != null
        ? `entrada de ${formatMoney(proposal.downPaymentAmount)}`
        : null;
  const partes = [
    entrada && `${entrada} ${emDias(proposal.downPaymentOffsetDays ?? 0)}`,
    `${proposal.installments} parcelas a partir de ${inicio}`,
  ].filter(Boolean);
  return `${regime} — ${partes.join(' + ')}`;
}

/** "no aceite" / "em 1 dia" / "em 30 dias" — o offset lido em português. */
function emDias(dias: number): string {
  if (dias === 0) return 'no aceite';
  return `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}
```

**Modify**: `apps/web/src/features/propostas/PropostaDetalhePage.tsx`

Na grade de dados (L239-270), célula nova antes de "Condições de pagamento", ocupando duas colunas:
```tsx
        <div className="flex flex-col gap-0.5 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Plano de cobrança</span>
          <span className="text-sm">{describeBillingPlan(proposal) ?? '—'}</span>
        </div>
```

No rodapé da tabela de itens (L303-308), o rótulo muda no regime recorrente — é a mitigação de rótulo da mudança de significado do `total`:
```tsx
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">
                  {proposal.billingType === 'RECURRING' ? 'Total mensal' : 'Total'}
                </TableCell>
                <TableCell className="font-semibold">
                  {formatMoney(proposal.total)}
                  {proposal.billingType === 'RECURRING' && (
                    <span className="text-muted-foreground"> /mês</span>
                  )}
                </TableCell>
              </TableRow>
```

**Modify**: `apps/web/src/features/propostas/PropostasListPage.tsx:196` — mesma marca na célula de total

```tsx
                  <TableCell>
                    {formatMoney(proposal.total)}
                    {proposal.billingType === 'RECURRING' && (
                      <span className="text-muted-foreground"> /mês</span>
                    )}
                  </TableCell>
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — sem erro de tipo
- [x] `pnpm --filter web lint`

#### Manual Verification
- [ ] Criar proposta sem escolher regime: o formulário não envia e a label do regime mostra o asterisco vermelho
- [ ] Trocar o regime esconde/mostra os campos certos, e trocar `Entrada` entre percentual e valor troca o controle
- [ ] Criar proposta `INSTALLMENTS` com entrada de 30% em 5 dias e 8 parcelas em 30 dias; a ficha mostra "Parcelado — entrada de 30% em 5 dias + 8 parcelas começando em 30 dias" (o spec dizia "a partir de em 30 dias", que não é português — `emDias` já traz a preposição)
- [ ] Editar essa proposta (DRAFT) reabre com o plano preenchido e o `Entrada` já em "Percentual"
- [ ] Proposta `RECURRING` mostra "Total mensal … /mês" na ficha e "/mês" na listagem
- [ ] Proposta antiga (sem plano) abre a ficha com "Plano de cobrança —" e não quebra
- [ ] Nenhum enum aparece cru (`RECURRING` etc.) em tela nenhuma

**⏸ PAUSE**: Parar para confirmação humana antes da Fase 4.

---

## Phase 4: Tela de conferência e vínculo nas duas fichas

### Goal

"Gerar contrato" abre uma tela que mostra o contrato e a agenda que serão criados, deixa ajustar o plano, e o vínculo proposta ↔ contrato fica visível nas duas fichas.

### Changes

#### API do frontend

**Modify**: `apps/web/src/lib/query-keys.ts` — em `contracts`

```ts
    byProposal: (proposalId: string) => ['contracts', 'proposal', proposalId] as const,
```

**Modify**: `apps/web/src/features/financeiro/api/types.ts`

```ts
export interface BillingPlanBody {
  billingType: BillingType;
  startOffsetDays: number;
  billingDay?: number;
  durationMonths?: number;
  downPaymentPercent?: number;
  downPaymentAmount?: number;
  downPaymentOffsetDays?: number;
  installments?: number;
}

export interface DeriveContractBody {
  description?: string;
  projectId?: string;
  /** Ausente = usar o plano gravado na proposta. */
  plano?: BillingPlanBody;
}

/** Cobrança que ainda não existe no banco — a prévia da agenda. */
export interface ScheduledCharge {
  description: string;
  amount: number;
  dueDate: string;
}

export interface ContractPreview {
  proposta: {
    id: string; number: string; version: number; status: string;
    total: string; decidedAt: string | null;
    clientId: string; client: { id: string; name: string };
  };
  plano: (BillingPlanBody & { [k: string]: unknown }) | null;
  derivado: {
    billingType: BillingType;
    monthlyAmount: number | null;
    billingDay: number | null;
    startDate: string | null;
    endDate: string | null;
    downPayment: number | null;
    installments: number | null;
    installmentAmount: number | null;
    cobrancas: ScheduledCharge[];
  } | null;
  descricaoSugerida: string;
  contratosExistentes: {
    id: string; description: string; status: ContractStatus; proposalId: string | null;
  }[];
}
```
e em `Contract`, a origem que o backend passou a incluir:
```ts
  proposalId?: string | null;
  proposal?: { id: string; number: string; version: number } | null;
```

**Modify**: `apps/web/src/features/financeiro/api/contracts.api.ts` e `hooks.ts` — três funções e três hooks

```ts
// contracts.api.ts
  previewFromProposal: (proposalId: string, body: DeriveContractBody) =>
    api.post<ContractPreview>(`/contracts/from-proposal/${proposalId}/preview`, body).then((r) => r.data),
  createFromProposal: (proposalId: string, body: DeriveContractBody) =>
    api.post<Contract>(`/contracts/from-proposal/${proposalId}`, body).then((r) => r.data),
  listByProposal: (proposalId: string) =>
    api.get<Contract[]>(`/contracts/by-proposal/${proposalId}`).then((r) => r.data),
```

```ts
// hooks.ts
/**
 * Prévia da derivação. É `useMutation` e não `useQuery` porque a rota é POST
 * (recebe o plano em edição) — mas não escreve nada, e o resultado é
 * descartável: cada ajuste no plano refaz a chamada.
 */
export function usePreviewContractFromProposal(proposalId: string) {
  return useMutation({
    mutationFn: (body: DeriveContractBody) =>
      contractsApi.previewFromProposal(proposalId, body),
  });
}

export function useContractsByProposal(proposalId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.contracts.byProposal(proposalId),
    queryFn: () => contractsApi.listByProposal(proposalId),
    enabled: enabled && !!proposalId,
  });
}

/** Gerar contrato mexe nas duas pontas: invalida `contracts` E `proposals`. */
export function useCreateContractFromProposal(proposalId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeriveContractBody) =>
      contractsApi.createFromProposal(proposalId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contracts.all });
      void qc.invalidateQueries({ queryKey: queryKeys.proposals.all });
    },
  });
}
```

#### Tela de conferência

**Create**: `apps/web/src/features/financeiro/GerarContratoDialog.tsx`

Um `Dialog` (`sm:max-w-4xl`), duas colunas: **plano** à esquerda, **o que será criado** à direita. Abre a partir da ficha da proposta, nunca sobre outro diálogo — e mesmo assim é o primitivo `Dialog` do design system, que já resolve a pilha (`apps/web/CLAUDE.md`).

Comportamento:
- Ao abrir, chama a prévia com body vazio (`{}`) → plano gravado.
- Os campos do plano são inicializados com `preview.plano`, ou vazios quando `plano === null` (proposta do histórico).
- Cada mudança de campo, com debounce de 400 ms (`useDebouncedValue`), refaz a prévia com `{ plano }`. Erro `422` de coerência aparece inline ("O que será criado" mostra o motivo em vez da agenda) — não como toast, porque é um estado da tela e não uma falha de ação.
- `contratosExistentes.length > 0` → banner de aviso, botão de gerar desabilitado e link "Ver contrato".
- Descrição do contrato é editável, pré-preenchida com `descricaoSugerida`.
- Botão "Gerar contrato" → `useCreateContractFromProposal` → `toast.success('Contrato gerado.')` → `navigate(\`/financeiro/contratos/${criado.id}\`)`. Erro → `toast.error(extractApiMessage(...))`.

A coluna direita, por regime:
- `INSTALLMENTS` / `ONE_TIME`: tabela da agenda (Descrição · Vencimento · Valor) com rodapé somando, e o aviso "As cobranças abaixo serão criadas ao gerar o contrato."
- `RECURRING`: sem tabela. Texto: "Nenhuma cobrança é criada agora — o sistema emite a mensalidade de {valor} todo dia {billingDay}, a partir de {startDate}{, até endDate | por tempo indeterminado}."

Os campos do plano são escritos direto neste arquivo, **duplicando** os do `ProposalFormDialog`. É deliberado: extrair um componente compartilhado significaria uma feature importando o interior de outra (`apps/web/CLAUDE.md`), e os dois contextos divergem — aqui o plano pode nascer vazio (histórico), não tem a moldura de "obrigatório na criação", e convive com a agenda ao lado.

#### Ficha da proposta

**Modify**: `apps/web/src/features/propostas/PropostaDetalhePage.tsx`

```ts
import { useCan } from '@/hooks/use-can';
import { useContractsByProposal } from '@/features/financeiro/api/hooks';
import { GerarContratoDialog } from '@/features/financeiro/GerarContratoDialog';
// ContratoFormDialog sai dos imports
```

```ts
  const { can, canAny } = useCan();
  const podeVerFinanceiro = canAny(['financeiro:ver', 'financeiro:gerenciar']);
  // Não peça dado que a pessoa não pode ver (apps/web/CLAUDE.md): a query
  // desliga e a seção não é renderizada.
  const { data: contratos } = useContractsByProposal(id, podeVerFinanceiro);
```

CTA (L219-224) — ganha o gate que não existia e vira "Gerar contrato":
```tsx
            {proposal.status === 'ACCEPTED' && can('financeiro:gerenciar') && (
              contratos && contratos.length > 0 ? (
                <Button variant="outline" onClick={() => navigate(`/financeiro/contratos/${contratos[0].id}`)}>
                  <FileSignature data-icon="inline-start" />
                  Ver contrato
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setContratoOpen(true)}>
                  <FileSignature data-icon="inline-start" />
                  Gerar contrato
                </Button>
              )
            )}
```

Seção nova depois de "Itens" e antes de "Versões", só quando `podeVerFinanceiro && contratos?.length`: tabela (Descrição · Regime · Status · Criado em) com `TableLink` para `/financeiro/contratos/:id`, usando `translateBillingType` e `translateContractStatus`.

E a substituição da costura (L352-359):
```tsx
      <GerarContratoDialog
        open={contratoOpen}
        onOpenChange={setContratoOpen}
        proposalId={proposal.id}
      />
```

#### Ficha do contrato

**Modify**: `apps/web/src/features/financeiro/ContratoDetalhePage.tsx` — célula nova na grade (após "Regime", L212-215)

```tsx
        {contract.proposal && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Proposta de origem</span>
            <span className="text-sm">
              <TableLink to={`/propostas/${contract.proposal.id}`}>
                {contract.proposal.number} · v{contract.proposal.version}
              </TableLink>
            </span>
          </div>
        )}
```

#### Limpeza da costura antiga

**Modify**: `apps/web/src/features/financeiro/ContratoFormDialog.tsx`

- Remover `defaultProposalId` e `suggestedAmount` de `Props` (L138-146) e da assinatura.
- Remover o `useEffect` de sugestão (L206-214) inteiro — a heurística que só valia para `INSTALLMENTS` e ignorava os outros dois regimes foi substituída pela derivação.
- Remover `proposalId: defaultProposalId` do body (L245): este diálogo passa a ser só o caminho manual, e contrato manual não tem proposta.
- Remover `watch('installmentAmount')` / `watch('downPayment')` se ficarem sem uso.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build`
- [x] `pnpm --filter web lint`
- [x] `grep -rn 'suggestedAmount\|defaultProposalId' apps/web/src` não retorna nada

#### Manual Verification
- [ ] Numa proposta aceita `INSTALLMENTS`, "Gerar contrato" abre a tela com a agenda somando exatamente o total da proposta
- [ ] Mudar a quantidade de parcelas na tela redesenha a agenda depois do debounce, sem recarregar a página
- [ ] Trocar a entrada de percentual para valor recalcula a entrada e as parcelas
- [ ] Numa proposta `RECURRING`, a tela mostra o texto de mensalidade e nenhuma tabela de cobranças
- [ ] Gerar o contrato navega para a ficha dele, que mostra "Proposta de origem" com link de volta
- [ ] Voltar para a proposta mostra a seção "Contratos gerados" e o botão agora diz "Ver contrato"
- [ ] Tentar gerar de novo (por outra versão da mesma cadeia) mostra o banner e o botão desabilitado
- [ ] Numa proposta aceita **antiga, sem plano**, a tela abre com os campos vazios e permite preencher à mão e gerar
- [ ] Colaborador com `financeiro:ver` (sem `gerenciar`) vê a seção "Contratos gerados" e **não** vê o botão de gerar
- [ ] Colaborador sem nenhuma permissão de financeiro não vê a seção nem o botão, e a aba de rede não mostra chamada a `/contracts/by-proposal`
- [ ] "Novo contrato" pelo módulo financeiro continua funcionando, agora sem sugestão de valor

**⏸ PAUSE**: Parar para confirmação humana. Fim do escopo.

---

## Testing Strategy

### Unit Tests

**`apps/api/src/shared/billing-plan.spec.ts`** (novo)
- `planoDoDto` devolve `undefined` sem `billingType` e normaliza ausentes para `null`
- `planoDaLinha` devolve `null` sem `billingType` e converte os dois `Decimal` de entrada em `number` — o teste passa um `Prisma.Decimal` de verdade e afirma `typeof === 'number'`, porque é a conversão ausente que produziria `NaN` silencioso na derivação
- `assertPlanoCoerente`: aceita os três regimes bem-formados; recusa `startOffsetDays` nulo; recusa `RECURRING` sem `billingDay`; recusa `RECURRING` com entrada ou parcelas; recusa `INSTALLMENTS` sem `installments`; recusa `INSTALLMENTS` com `billingDay`/`durationMonths`; recusa as duas entradas juntas; recusa `downPaymentOffsetDays` sem entrada; recusa `ONE_TIME` com qualquer campo dos outros regimes
- Toda mensagem em pt-BR e do tipo `UnprocessableEntityException`

**`apps/api/src/modules/finance/application/proposal-plan.spec.ts`** (novo)
- `ratearParcelas`: divisão exata; sobra de 1, 2 e N−1 centavos toda na última; soma sempre igual a `total − entrada`; entrada ≥ total → parcelas de 0
- `entradaEmCentavos`: percentual arredondado; valor literal; nenhum dos dois → 0; nunca acima do total
- `derivarContrato` `RECURRING`: `monthlyAmount = total`, `startDate = decidedAt + offset` em meia-noite UTC, `endDate` por `durationMonths`, `cobrancas: []`
- `derivarContrato` `ONE_TIME`: uma cobrança com o total no vencimento derivado
- `derivarContrato` `INSTALLMENTS`: entrada + N parcelas, soma exata, vencimentos mês a mês, última diferente quando há sobra
- Âncora com hora (ex.: `2026-08-10T17:42:31Z`) produz vencimentos em `00:00:00Z` — é o teste que protege o cron

**`apps/api/src/modules/finance/application/schedule.spec.ts`** (estender)
- `addDays` atravessando virada de mês e de ano em UTC
- `aoDiaUtc` zerando hora
- `buildInstallmentSchedule` com `lastInstallmentAmount` → só a última difere; sem ele → todas iguais (retrocompatibilidade dos testes atuais)

**`apps/api/src/modules/finance/application/contracts.service.spec.ts`** (estender)
- Mock novo no `repo`: `findByProposalIds`; mock novo no construtor: `proposals` (`findOne`, `versions`)
- `createFromProposal`: 404 de proposta de outro owner (propagado do `ProposalsService`); 422 em status ≠ `ACCEPTED`; 422 sem plano; 409 quando a cadeia já tem contrato; 422 quando a entrada cobre o total; caminho felizes dos três regimes gravando os campos certos; P2002 → 409
- Auditoria: **um** `registrar` com `action: 'CRIAR'` e `propostaNumero` no `extra`
- `previewFromProposal`: não chama `repo.create`; devolve `derivado: null` quando a proposta não tem plano; devolve `contratosExistentes` preenchido sem lançar

**`apps/api/src/modules/proposals/application/proposals.service.spec.ts`** (estender)
- `create` persiste as 8 colunas e chama `assertPlanoCoerente` (rejeita plano incoerente antes de tocar o repo)
- `update` sem `billingType` não manda nenhuma coluna de plano ao repo
- `update` com `billingType` e sem o obrigatório do regime lança 422
- `newVersion` clona o plano campo a campo

### Integration Tests

Sem e2e novo (ver "What We're NOT Doing"). A verificação de integração é manual, pela lista de cada fase, com atenção a três costuras que só aparecem com o sistema de pé:
- **Cron × derivação**: contrato `RECURRING` derivado tem de ser pego pela rotina diária. Conferir com `startDate` no passado e `billingDay` já vencido no mês corrente, e verificar que a mensalidade é gerada — é o caminho que o truncamento de `aoDiaUtc` protege.
- **RLS × rota nova**: as três rotas rodam dentro da transação do `OwnerContextInterceptor`. Conferir com dois owners que a proposta de um responde `404` para o outro.
- **Auditoria × cobranças**: gerar um contrato de 12 parcelas e confirmar **um** registro na trilha, não 13.

### Migration & Rollback

**Aplicação.** `20260818100000_proposal_billing_plan` é aditiva nas colunas e troca constraint no índice. Em produção, o `entrypoint.sh` roda `prisma migrate deploy` no start; se houver duplicata de `proposalId`, o `RAISE EXCEPTION` reprova a migration e **a API não sobe** (`app.migracao_falhou`). Por isso, antes do deploy:

```sql
SELECT "proposalId", count(*) FROM "Contract"
 WHERE "proposalId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

Se retornar linha, o owner decide qual contrato mantém — cancelar ou desvincular (`UPDATE "Contract" SET "proposalId" = NULL WHERE id = …`) o excedente. Não automatize essa escolha.

**Rollback.** As 8 colunas são nullable e não têm leitor obrigatório: derrubar o deploy do código e deixar as colunas no banco é seguro (nenhum caminho antigo as lê). Se for preciso reverter o schema:

```sql
DROP INDEX "Contract_proposalId_key";
ALTER TABLE "Proposal"
  DROP COLUMN "billingType", DROP COLUMN "startOffsetDays",
  DROP COLUMN "billingDay", DROP COLUMN "durationMonths",
  DROP COLUMN "downPaymentPercent", DROP COLUMN "downPaymentAmount",
  DROP COLUMN "downPaymentOffsetDays", DROP COLUMN "installments";
```

Contratos já derivados **permanecem válidos** — são `Contract` comuns, com `proposalId` preenchido, indistinguíveis dos criados à mão. Nada a desfazer no financeiro.

**Sem migração de dado.** Propostas existentes ficam sem plano e continuam gerando contrato pela tela de conferência preenchida à mão. Não há backfill possível: `paymentTerms` é texto livre e adivinhar regime a partir dele produziria plano errado com cara de certo.

## Environment Considerations

- **CI/CD**: nenhum passo novo. O portão `scripts/validar-migrations-com-dados.sh` já roda a cada push que toca a API e passa a exercitar o bloco novo de `invariantes.sql`.
- **Migrations**: uma (`20260818100000_proposal_billing_plan`). Rodar o portão localmente antes do PR, com o `DATABASE_URL` de `localhost:5435`.
- **Config/Secrets**: nenhuma variável nova.
- **Permissões**: nenhuma chave nova em `shared/permissions.ts`. As rotas reusam `financeiro:gerenciar` (escrita e prévia) e `financeiro:ver` (leitura).
- **Multi-environment**: sem diferença entre dev/staging/prod. Em dev, `docker compose up -d` para o Postgres em `localhost:5435`.
- **Observabilidade**: um evento novo (`contrato.derivado_de_proposta`) documentado em `docs/observabilidade.md`. O nome é estável — renomear depois quebra a contagem histórica no Grafana.

## Dependencies & Risks

- **Duplicata preexistente de `proposalId` bloqueia o start da API.** É o risco de maior impacto do plano. Mitigação: a consulta acima antes do deploy, e a mensagem da migration nomeando a proposta. Nada aqui desempata sozinho.
- **Ordem das fases é dependência real, não preferência.** A Fase 2 usa o tipo `BillingPlan` e as colunas da Fase 1; a Fase 4 renderiza `contract.proposal`, incluído no repositório na Fase 2. Fase 3 e Fase 4 são independentes entre si e podem ser invertidas.
- **`total` muda de significado em `RECURRING`.** Já aceito no PRD. Este plano mitiga só o rótulo (ficha e listagem de propostas). `DashboardRepository.proposalsOpen` continua somando grandezas diferentes — se isso incomodar em produção, é item de produto à parte.
- **Duplicação deliberada em dois pontos**, que um revisor vai questionar e que é resposta à regra "um módulo/feature não importa o interior de outro": `BillingPlanDto` em `finance/api/dto` (a *regra* não é duplicada — vive em `shared/billing-plan.ts`) e os campos de plano no `GerarContratoDialog` (os *rótulos* não são duplicados — vêm de `@/lib/labels`).
- **Debounce da prévia**: cada ajuste na tela de conferência é uma requisição. 400 ms e uma tela usada por poucos usuários simultâneos tornam isso irrelevante, mas a rota é POST e não tem cache — não a chame em `onChange` sem debounce.
- **`Proposal.installments` e `Contract.installments` têm o mesmo nome e significados iguais**, o que é bom; `billingDay` também. Já `startOffsetDays` não tem par no contrato — é a forma mista que o PRD apontou (offset de início + dia do mês), e a derivação é o único lugar onde as duas unidades se encontram.

## References

- PRD: `specs/research/2026-07-29-plano-de-cobranca-na-proposta.md`
- Limitação encerrada: `specs/plans/2026-07-23-fase-5-financeiro.md:1080`
- Pergunta aberta original: `specs/research/2026-07-23-fase-5-financeiro.md:204`
- Insumo da fase seguinte: `ROADMAP.md:380-391` (Fase 11 — "proposta que o cliente vê")
- Regras de migration com dado: `apps/api/CLAUDE.md` → "Migration é validada com dado dentro"
- Regras de log: `apps/api/CLAUDE.md` → "Log estruturado" e `docs/observabilidade.md`
- `NULLS DISTINCT` no PostgreSQL: comportamento padrão de `UNIQUE` em coluna nullable — é o que dispensa o índice parcial
