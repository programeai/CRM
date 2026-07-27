import { calcularDiff } from './audit-diff';

describe('calcularDiff', () => {
  it('devolve null quando nada mudou', () => {
    expect(
      calcularDiff({ status: 'PENDING' }, { status: 'PENDING' }),
    ).toBeNull();
  });

  it('traz só os campos que mudaram', () => {
    expect(
      calcularDiff(
        { status: 'PENDING', amount: 100, description: 'Mensalidade' },
        { status: 'PAID', amount: 100, description: 'Mensalidade' },
      ),
    ).toEqual({ status: { antes: 'PENDING', depois: 'PAID' } });
  });

  it('não deixa campo omitido vazar mesmo quando muda', () => {
    expect(
      calcularDiff(
        { passwordHash: 'a', status: 'PENDING' },
        { passwordHash: 'b', status: 'PAID' },
      ),
    ).toEqual({ status: { antes: 'PENDING', depois: 'PAID' } });
  });

  it('normaliza Decimal (objeto com toFixed) para string', () => {
    const antes = { amount: { toFixed: () => '10.00', toString: () => '10' } };
    const depois = { amount: { toFixed: () => '10.00', toString: () => '20' } };

    expect(calcularDiff(antes, depois)).toEqual({
      amount: { antes: '10', depois: '20' },
    });
  });

  it('não acusa diferença entre Decimal(10.00) e Decimal(10) com o mesmo toString', () => {
    const antes = { amount: { toFixed: () => '10.00', toString: () => '10' } };
    const depois = { amount: { toFixed: () => '10.00', toString: () => '10' } };

    expect(calcularDiff(antes, depois)).toBeNull();
  });

  it('normaliza Date para ISO string', () => {
    const antes = { paidAt: null };
    const depois = { paidAt: new Date('2026-07-26T12:00:00.000Z') };

    expect(calcularDiff(antes, depois)).toEqual({
      paidAt: { antes: null, depois: '2026-07-26T12:00:00.000Z' },
    });
  });

  it('campo presente só de um lado entra como undefined → valor', () => {
    expect(calcularDiff({}, { notes: 'novo' })).toEqual({
      notes: { antes: null, depois: 'novo' },
    });
  });

  it('não despeja relação carregada junto (payments/items) no diff', () => {
    expect(
      calcularDiff(
        { status: 'ACTIVE', payments: [{ id: 'p1', status: 'PENDING' }] },
        { status: 'CANCELED', payments: [{ id: 'p1', status: 'CANCELED' }] },
      ),
    ).toEqual({ status: { antes: 'ACTIVE', depois: 'CANCELED' } });
  });

  it('aceita um conjunto de omissão customizado', () => {
    expect(
      calcularDiff({ campoX: 1 }, { campoX: 2 }, new Set(['campoX'])),
    ).toBeNull();
  });
});
