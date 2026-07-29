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
