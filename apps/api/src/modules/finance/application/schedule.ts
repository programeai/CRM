import { fromCents, toCents } from './money';

export interface ScheduledCharge {
  description: string;
  amount: number; // reais, 2 casas (gravado no Decimal)
  dueDate: Date;
}

/**
 * Soma n meses preservando o dia (billingDay é 1–28, então nunca "transborda" o mês).
 * Usa os campos UTC: as datas de entrada chegam do DTO como string ISO "AAAA-MM-DD"
 * (`new Date('2026-09-01')` == meia-noite UTC); somar meses com `setMonth`/`getMonth`
 * (hora local) deslocaria o dia sempre que o fuso do servidor for negativo (ex.: o
 * UTC vira o dia anterior em UTC-3), estourando o mês (dia 31 "vira" outro mês).
 */
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

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

/**
 * Agenda de INSTALLMENTS: Entrada (se downPayment > 0) + N parcelas iguais.
 * Vencimentos: entrada em downPaymentDueDate; parcela i em firstInstallmentDueDate + (i-1) meses.
 * Soma exata por construção (downPayment + installments × installmentAmount).
 */
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
  const charges: ScheduledCharge[] = [];
  if (input.downPayment && input.downPayment > 0) {
    charges.push({
      description: 'Entrada',
      amount: fromCents(toCents(input.downPayment)),
      dueDate: input.downPaymentDueDate ?? input.firstInstallmentDueDate,
    });
  }
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

/** Agenda de ONE_TIME: cobrança única. */
export function buildOneTimeSchedule(
  amount: number,
  dueDate: Date,
): ScheduledCharge[] {
  return [
    {
      description: 'Pagamento único',
      amount: fromCents(toCents(amount)),
      dueDate,
    },
  ];
}

/**
 * Datas de vencimento (billingDay) dentro da janela (from, to], respeitando start/end.
 * Usada pelo cron para descobrir quais mensalidades gerar. Determinística.
 */
export function billingDatesInWindow(
  input: { billingDay: number; startDate: Date; endDate: Date | null },
  from: Date,
  to: Date,
): Date[] {
  const dates: Date[] = [];
  // Varre do mês de `from` até o mês de `to`, montando o dia de cobrança de cada mês.
  const cursor = new Date(
    from.getFullYear(),
    from.getMonth(),
    input.billingDay,
    0,
    0,
    0,
    0,
  );
  const limit = new Date(to.getFullYear(), to.getMonth() + 1, 1);
  while (cursor < limit) {
    if (
      cursor > from &&
      cursor <= to &&
      cursor >= input.startDate &&
      (input.endDate == null || cursor <= input.endDate)
    ) {
      dates.push(new Date(cursor));
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return dates;
}
