import { empilharNota, montarNotaDeLead, LIMITE_DE_NOTA } from './nota-de-lead';

describe('nota de lead', () => {
  it('abre pela origem e pela hora, e traz o cenário antes do resumo', () => {
    const nota = montarNotaDeLead({
      origem: 'site-institucional',
      pagina: '/',
      recebidoEm: '2026-07-27T17:32:00.000Z',
      cenario: 'Operação no limite',
      resumo: 'Pergunta: resposta.',
      mensagem: 'Preciso de site novo.',
      email: 'lead@teste.local',
      cidade: 'Mossoró',
    });

    expect(nota).toContain('por site-institucional');
    expect(nota).toContain('Página: /');
    expect(nota).toContain('Cidade informada: Mossoró');
    expect(nota).toContain('Cenário: Operação no limite');
    expect(nota.indexOf('Cenário')).toBeLessThan(nota.indexOf('Pergunta'));
    expect(nota).toContain('Mensagem: Preciso de site novo.');
  });

  it('omite a hora quando a origem não manda `recebidoEm` válido', () => {
    expect(montarNotaDeLead({ origem: 'site', recebidoEm: 'ontem' })).toBe(
      'Lead recebido por site.',
    );
    expect(montarNotaDeLead({ origem: 'site' })).toBe(
      'Lead recebido por site.',
    );
  });

  it('empilha a nota nova em cima da anterior', () => {
    const empilhada = empilharNota('Contato de junho.', 'Contato de julho.');

    expect(empilhada.startsWith('Contato de julho.')).toBe(true);
    expect(empilhada).toContain('Contato de junho.');
  });

  it('corta no limite comendo o passado, nunca a nota que acabou de chegar', () => {
    const nova = 'N'.repeat(200);
    const empilhada = empilharNota('V'.repeat(LIMITE_DE_NOTA), nova);

    expect(empilhada).toHaveLength(LIMITE_DE_NOTA);
    expect(empilhada.startsWith(nova)).toBe(true);
  });

  it('trata nota anterior vazia como ausente, sem separador solto', () => {
    expect(empilharNota('   ', 'Nova.')).toBe('Nova.');
    expect(empilharNota(null, 'Nova.')).toBe('Nova.');
  });
});
