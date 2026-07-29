import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertPlanoCoerente,
  planoDaLinha,
  planoDoDto,
  type BillingPlan,
} from './billing-plan';

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

describe('planoDoDto', () => {
  it('devolve undefined quando billingType não veio', () => {
    expect(planoDoDto({})).toBeUndefined();
    expect(planoDoDto({ installments: 5 })).toBeUndefined();
  });

  it('normaliza campos ausentes para null', () => {
    expect(planoDoDto({ billingType: 'ONE_TIME', startOffsetDays: 3 })).toEqual(
      {
        billingType: 'ONE_TIME',
        startOffsetDays: 3,
        billingDay: null,
        durationMonths: null,
        downPaymentPercent: null,
        downPaymentAmount: null,
        downPaymentOffsetDays: null,
        installments: null,
      },
    );
  });
});

describe('planoDaLinha', () => {
  it('devolve null sem billingType', () => {
    expect(
      planoDaLinha({
        billingType: null,
        startOffsetDays: null,
        billingDay: null,
        durationMonths: null,
        downPaymentPercent: null,
        downPaymentAmount: null,
        downPaymentOffsetDays: null,
        installments: null,
      }),
    ).toBeNull();
  });

  it('converte os dois Decimal de entrada em number', () => {
    const plano = planoDaLinha({
      billingType: 'INSTALLMENTS',
      startOffsetDays: 30,
      billingDay: null,
      durationMonths: null,
      downPaymentPercent: new Prisma.Decimal('30.00'),
      downPaymentAmount: new Prisma.Decimal('3000.00'),
      downPaymentOffsetDays: 5,
      installments: 8,
    });
    expect(plano).not.toBeNull();
    expect(typeof plano!.downPaymentPercent).toBe('number');
    expect(typeof plano!.downPaymentAmount).toBe('number');
    expect(plano!.downPaymentPercent).toBe(30);
    expect(plano!.downPaymentAmount).toBe(3000);
  });
});

describe('assertPlanoCoerente', () => {
  it('aceita RECURRING bem-formado', () => {
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'RECURRING',
        billingDay: 10,
      }),
    ).not.toThrow();
  });

  it('aceita INSTALLMENTS bem-formado', () => {
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'INSTALLMENTS',
        installments: 3,
      }),
    ).not.toThrow();
  });

  it('aceita ONE_TIME bem-formado', () => {
    expect(() => assertPlanoCoerente(planoBase)).not.toThrow();
  });

  it('recusa startOffsetDays nulo', () => {
    expect(() =>
      assertPlanoCoerente({ ...planoBase, startOffsetDays: null }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa RECURRING sem billingDay', () => {
    expect(() =>
      assertPlanoCoerente({ ...planoBase, billingType: 'RECURRING' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa RECURRING com entrada ou parcelas', () => {
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'RECURRING',
        billingDay: 10,
        installments: 3,
      }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'RECURRING',
        billingDay: 10,
        downPaymentPercent: 10,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa INSTALLMENTS sem installments', () => {
    expect(() =>
      assertPlanoCoerente({ ...planoBase, billingType: 'INSTALLMENTS' }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa INSTALLMENTS com billingDay ou durationMonths', () => {
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'INSTALLMENTS',
        installments: 3,
        billingDay: 10,
      }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'INSTALLMENTS',
        installments: 3,
        durationMonths: 12,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa as duas entradas juntas', () => {
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'INSTALLMENTS',
        installments: 3,
        downPaymentPercent: 30,
        downPaymentAmount: 3000,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa downPaymentOffsetDays sem entrada', () => {
    expect(() =>
      assertPlanoCoerente({
        ...planoBase,
        billingType: 'INSTALLMENTS',
        installments: 3,
        downPaymentOffsetDays: 5,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('recusa ONE_TIME com qualquer campo dos outros regimes', () => {
    expect(() => assertPlanoCoerente({ ...planoBase, billingDay: 10 })).toThrow(
      UnprocessableEntityException,
    );
    expect(() =>
      assertPlanoCoerente({ ...planoBase, durationMonths: 12 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertPlanoCoerente({ ...planoBase, installments: 3 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertPlanoCoerente({ ...planoBase, downPaymentPercent: 10 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertPlanoCoerente({ ...planoBase, downPaymentAmount: 100 }),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertPlanoCoerente({ ...planoBase, downPaymentOffsetDays: 5 }),
    ).toThrow(UnprocessableEntityException);
  });

  it('toda mensagem é em pt-BR e do tipo UnprocessableEntityException', () => {
    try {
      assertPlanoCoerente({ ...planoBase, billingType: 'RECURRING' });
      fail('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect((e as UnprocessableEntityException).message).toMatch(
        /dia de vencimento/i,
      );
    }
  });
});
