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
 * Agenda de INSTALLMENTS: Entrada (se downPayment > 0) + N parcelas iguais.
 * Vencimentos: entrada em downPaymentDueDate; parcela i em firstInstallmentDueDate + (i-1) meses.
 * Soma exata por construção (downPayment + installments × installmentAmount).
 */
export function buildInstallmentSchedule(input: {
  downPayment?: number | null;
  downPaymentDueDate?: Date | null;
  installments: number;
  installmentAmount: number;
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
    charges.push({
      description: `Parcela ${i}/${input.installments}`,
      amount: fromCents(toCents(input.installmentAmount)),
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
