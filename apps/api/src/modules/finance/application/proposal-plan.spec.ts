import {
  derivarContrato,
  entradaEmCentavos,
  ratearParcelas,
} from './proposal-plan';
import type { BillingPlan } from '../../../shared/billing-plan';

const planoBase: BillingPlan = {
  billingType: 'ONE_TIME',
  startOffsetDays: 0,
  billingDay: null,
  durationMonths: null,
  downPaymentPercent: null,
  downPaymentAmount: null,
  downPaymentOffsetDays: null,
  installments: null,
};

describe('ratearParcelas', () => {
  it('divide exatamente quando o resto é zero', () => {
    expect(ratearParcelas(10000, 0, 4)).toEqual({
      parcelaCents: 2500,
      ultimaCents: 2500,
    });
  });

  it('sobra de 1 centavo vai toda para a última', () => {
    // 1001 / 4 = 250,25 → floor 250, 3 primeiras 250, resto 1001-750=251
    expect(ratearParcelas(1001, 0, 4)).toEqual({
      parcelaCents: 250,
      ultimaCents: 251,
    });
  });

  it('sobra de N-1 centavos vai toda para a última', () => {
    // 1148000 (11.480,00) - 300000 (3.000,00) entrada = 848000, / 3 = 282666,66
    expect(ratearParcelas(1148000, 300000, 3)).toEqual({
      parcelaCents: 282666,
      ultimaCents: 282668,
    });
  });

  it('a soma sempre fecha com total - entrada', () => {
    const { parcelaCents, ultimaCents } = ratearParcelas(1148000, 300000, 3);
    expect(parcelaCents * 2 + ultimaCents).toBe(1148000 - 300000);
  });

  it('entrada maior ou igual ao total gera parcelas de 0', () => {
    expect(ratearParcelas(10000, 10000, 5)).toEqual({
      parcelaCents: 0,
      ultimaCents: 0,
    });
    expect(ratearParcelas(10000, 15000, 5)).toEqual({
      parcelaCents: 0,
      ultimaCents: 0,
    });
  });
});

describe('entradaEmCentavos', () => {
  it('percentual arredondado sobre o total', () => {
    expect(
      entradaEmCentavos({ ...planoBase, downPaymentPercent: 30 }, 1148000),
    ).toBe(344400);
  });

  it('valor literal em centavos', () => {
    expect(
      entradaEmCentavos({ ...planoBase, downPaymentAmount: 3000 }, 1148000),
    ).toBe(300000);
  });

  it('nenhum dos dois preenchido → 0', () => {
    expect(entradaEmCentavos(planoBase, 1148000)).toBe(0);
  });

  it('nunca acima do total', () => {
    expect(
      entradaEmCentavos({ ...planoBase, downPaymentPercent: 150 }, 1148000),
    ).toBe(1148000);
    expect(
      entradaEmCentavos({ ...planoBase, downPaymentAmount: 999999 }, 1148000),
    ).toBe(1148000);
  });
});

describe('derivarContrato', () => {
  it('RECURRING: monthlyAmount = total, startDate = decidedAt + offset, endDate por durationMonths, sem cobranças', () => {
    const derivado = derivarContrato({
      plano: {
        ...planoBase,
        billingType: 'RECURRING',
        startOffsetDays: 10,
        billingDay: 5,
        durationMonths: 12,
      },
      total: 800,
      ancora: new Date('2026-08-10T17:42:31.000Z'),
    });
    expect(derivado.billingType).toBe('RECURRING');
    expect(derivado.monthlyAmount).toBe(800);
    expect(derivado.billingDay).toBe(5);
    expect(derivado.startDate?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(derivado.endDate?.toISOString()).toBe('2027-08-20T00:00:00.000Z');
    expect(derivado.cobrancas).toEqual([]);
  });

  it('RECURRING sem durationMonths: endDate null (tempo indeterminado)', () => {
    const derivado = derivarContrato({
      plano: {
        ...planoBase,
        billingType: 'RECURRING',
        startOffsetDays: 0,
        billingDay: 10,
        durationMonths: null,
      },
      total: 500,
      ancora: new Date('2026-08-10T00:00:00.000Z'),
    });
    expect(derivado.endDate).toBeNull();
  });

  it('ONE_TIME: uma cobrança com o total no vencimento derivado', () => {
    const derivado = derivarContrato({
      plano: { ...planoBase, billingType: 'ONE_TIME', startOffsetDays: 15 },
      total: 3000,
      ancora: new Date('2026-08-10T00:00:00.000Z'),
    });
    expect(derivado.cobrancas).toEqual([
      {
        description: 'Pagamento único',
        amount: 3000,
        dueDate: new Date('2026-08-25T00:00:00.000Z'),
      },
    ]);
  });

  it('INSTALLMENTS: entrada + N parcelas cuja soma fecha exatamente, última diferente quando há sobra', () => {
    const derivado = derivarContrato({
      plano: {
        ...planoBase,
        billingType: 'INSTALLMENTS',
        startOffsetDays: 30,
        downPaymentPercent: 30,
        downPaymentOffsetDays: 5,
        installments: 3,
      },
      total: 11480,
      ancora: new Date('2026-08-10T00:00:00.000Z'),
    });
    expect(derivado.downPayment).toBe(3444);
    expect(derivado.installments).toBe(3);
    expect(derivado.installmentAmount).toBe(2678.66);
    expect(derivado.cobrancas).toHaveLength(4); // entrada + 3 parcelas
    const total = derivado.cobrancas.reduce((s, c) => s + c.amount, 0);
    expect(total).toBeCloseTo(11480, 2);
    expect(derivado.cobrancas[0]).toEqual(
      expect.objectContaining({
        description: 'Entrada',
        amount: 3444,
        dueDate: new Date('2026-08-15T00:00:00.000Z'),
      }),
    );
    expect(derivado.cobrancas[1].dueDate.toISOString()).toBe(
      '2026-09-09T00:00:00.000Z',
    );
    expect(derivado.cobrancas[3].amount).toBe(2678.68); // última absorve a sobra
  });

  it('âncora com hora produz vencimentos em meia-noite UTC — protege o cron', () => {
    const derivado = derivarContrato({
      plano: {
        ...planoBase,
        billingType: 'ONE_TIME',
        startOffsetDays: 0,
      },
      total: 100,
      ancora: new Date('2026-08-10T23:59:59.000Z'),
    });
    expect(derivado.cobrancas[0].dueDate.toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    );
  });
});
