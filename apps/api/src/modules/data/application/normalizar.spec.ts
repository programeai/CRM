import { normalizar } from './normalizar';

describe('normalizar', () => {
  it('remove acento', () => {
    expect(normalizar('Tráfego pago')).toBe('trafego pago');
  });

  it('baixa a caixa', () => {
    expect(normalizar('INDICAÇÃO')).toBe('indicacao');
  });

  it('colapsa espaço duplo', () => {
    expect(normalizar('Prospecção  ativa')).toBe('prospeccao ativa');
  });

  it('remove cedilha (ç)', () => {
    expect(normalizar('Ção')).toBe('cao');
  });

  it('devolve string vazia para entrada vazia ou só espaço', () => {
    expect(normalizar('')).toBe('');
    expect(normalizar('   ')).toBe('');
  });
});
