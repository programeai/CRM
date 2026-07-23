import { computeTotal } from './money';

describe('computeTotal', () => {
  it('soma itens sem erro de float (0.1 + 0.2)', () => {
    expect(
      computeTotal([
        { quantity: 1, unitPrice: 0.1 },
        { quantity: 1, unitPrice: 0.2 },
      ]),
    ).toBe(0.3);
  });
  it('multiplica quantidade × valor unitário', () => {
    expect(computeTotal([{ quantity: 3, unitPrice: 99.9 }])).toBe(299.7);
  });
  it('subtrai o desconto', () => {
    expect(computeTotal([{ quantity: 1, unitPrice: 1000 }], 150)).toBe(850);
  });
  it('nunca fica negativo', () => {
    expect(computeTotal([{ quantity: 1, unitPrice: 100 }], 999)).toBe(0);
  });
});
