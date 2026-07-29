import {
  addDays,
  aoDiaUtc,
  billingDatesInWindow,
  buildInstallmentSchedule,
  buildOneTimeSchedule,
} from './schedule';

describe('buildInstallmentSchedule', () => {
  it('gera Entrada + N parcelas cuja soma fecha exatamente', () => {
    const charges = buildInstallmentSchedule({
      downPayment: 1000,
      downPaymentDueDate: new Date('2026-08-01'),
      installments: 8,
      installmentAmount: 500,
      firstInstallmentDueDate: new Date('2026-09-01'),
    });
    expect(charges).toHaveLength(9); // Entrada + 8 parcelas
    const total = charges.reduce((sum, c) => sum + c.amount, 0);
    expect(total).toBe(1000 + 8 * 500);
    expect(charges[0]).toEqual(
      expect.objectContaining({ description: 'Entrada', amount: 1000 }),
    );
    expect(charges[1].description).toBe('Parcela 1/8');
    expect(charges[8].description).toBe('Parcela 8/8');
  });

  it('vencimentos mês a mês a partir da 1ª parcela', () => {
    const charges = buildInstallmentSchedule({
      installments: 3,
      installmentAmount: 100,
      firstInstallmentDueDate: new Date(2026, 0, 15),
    });
    expect(charges.map((c) => c.dueDate.getMonth())).toEqual([0, 1, 2]);
    expect(charges.every((c) => c.dueDate.getDate() === 15)).toBe(true);
  });

  it('sem entrada quando downPayment é 0 ou ausente', () => {
    const charges = buildInstallmentSchedule({
      downPayment: 0,
      installments: 2,
      installmentAmount: 250,
      firstInstallmentDueDate: new Date('2026-01-01'),
    });
    expect(charges).toHaveLength(2);
    expect(charges.reduce((sum, c) => sum + c.amount, 0)).toBe(500);
  });

  it('com lastInstallmentAmount, só a última parcela difere', () => {
    const charges = buildInstallmentSchedule({
      installments: 3,
      installmentAmount: 100,
      lastInstallmentAmount: 100.02,
      firstInstallmentDueDate: new Date('2026-01-15'),
    });
    expect(charges.map((c) => c.amount)).toEqual([100, 100, 100.02]);
  });

  it('sem lastInstallmentAmount, todas as parcelas são iguais (retrocompatibilidade)', () => {
    const charges = buildInstallmentSchedule({
      installments: 3,
      installmentAmount: 100,
      firstInstallmentDueDate: new Date('2026-01-15'),
    });
    expect(charges.map((c) => c.amount)).toEqual([100, 100, 100]);
  });
});

describe('addDays', () => {
  it('soma dias em UTC atravessando virada de mês', () => {
    const d = addDays(new Date('2026-01-30T00:00:00.000Z'), 3);
    expect(d.toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });

  it('soma dias em UTC atravessando virada de ano', () => {
    const d = addDays(new Date('2026-12-30T00:00:00.000Z'), 5);
    expect(d.toISOString()).toBe('2027-01-04T00:00:00.000Z');
  });
});

describe('aoDiaUtc', () => {
  it('zera a hora, mantendo o dia em UTC', () => {
    const d = aoDiaUtc(new Date('2026-08-10T17:42:31.000Z'));
    expect(d.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });
});

describe('buildOneTimeSchedule', () => {
  it('gera uma única cobrança com o vencimento informado', () => {
    const dueDate = new Date('2026-10-01');
    const charges = buildOneTimeSchedule(1500, dueDate);
    expect(charges).toEqual([
      { description: 'Pagamento único', amount: 1500, dueDate },
    ]);
  });
});

describe('billingDatesInWindow', () => {
  it('inclui a data de cobrança dentro da janela (from, to]', () => {
    const dates = billingDatesInWindow(
      { billingDay: 10, startDate: new Date('2026-01-01'), endDate: null },
      new Date('2026-06-20'),
      new Date('2026-07-20'),
    );
    expect(dates).toHaveLength(1);
    expect(dates[0].getMonth()).toBe(6); // julho
    expect(dates[0].getDate()).toBe(10);
  });

  it('exclui datas fora da janela', () => {
    const dates = billingDatesInWindow(
      { billingDay: 10, startDate: new Date('2026-01-01'), endDate: null },
      new Date('2026-06-01'),
      new Date('2026-06-05'),
    );
    expect(dates).toHaveLength(0);
  });

  it('exclui datas fora do intervalo [startDate, endDate] do contrato', () => {
    const dates = billingDatesInWindow(
      {
        billingDay: 10,
        startDate: new Date('2026-08-01'),
        endDate: null,
      },
      new Date('2026-06-20'),
      new Date('2026-07-20'),
    );
    expect(dates).toHaveLength(0);
  });

  it('exclui datas após o endDate do contrato', () => {
    const dates = billingDatesInWindow(
      {
        billingDay: 10,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
      },
      new Date('2026-06-20'),
      new Date('2026-07-20'),
    );
    expect(dates).toHaveLength(0);
  });
});
