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
      erro(
        'A entrada é em percentual ou em valor — preencha apenas um dos dois.',
      );
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
