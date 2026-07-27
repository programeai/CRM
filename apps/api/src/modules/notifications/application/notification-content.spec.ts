import { linkDoRegistro, montarConteudo } from './notification-content';

describe('linkDoRegistro', () => {
  it('CLIENT → /clientes/:id', () => {
    expect(linkDoRegistro('CLIENT', 'c1')).toBe('/clientes/c1');
  });

  it('ACTIVITY com clientId → /clientes/:clientId/timeline', () => {
    expect(linkDoRegistro('ACTIVITY', 'a1', 'c1')).toBe(
      '/clientes/c1/timeline',
    );
  });

  it('ACTIVITY sem clientId → null', () => {
    expect(linkDoRegistro('ACTIVITY', 'a1')).toBeNull();
  });

  it('DEAL → /pipeline (fixo, não pelo id)', () => {
    expect(linkDoRegistro('DEAL', 'd1')).toBe('/pipeline');
  });

  it('TASK → /demandas (fixo, não pelo id)', () => {
    expect(linkDoRegistro('TASK', 't1')).toBe('/demandas');
  });

  it('PROPOSAL → /propostas/:id', () => {
    expect(linkDoRegistro('PROPOSAL', 'p1')).toBe('/propostas/p1');
  });

  it('PAYMENT → /financeiro (fixo, não pelo id)', () => {
    expect(linkDoRegistro('PAYMENT', 'pay1')).toBe('/financeiro');
  });

  it('PROJECT → /projetos/:id', () => {
    expect(linkDoRegistro('PROJECT', 'proj1')).toBe('/projetos/proj1');
  });

  it('entidade sem tela própria (ex.: CONTACT) → null', () => {
    expect(linkDoRegistro('CONTACT', 'ct1')).toBeNull();
  });
});

describe('montarConteudo', () => {
  it('RECORD_ASSIGNED com autorNome conhecido nomeia quem atribuiu', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'RECORD_ASSIGNED',
        entity: 'DEAL',
        entityId: 'd1',
        entityLabel: 'Site institucional',
      },
      { autorNome: 'Fulana' },
    );

    expect(conteudo.title).toBe('Atribuíram a oportunidade a você');
    expect(conteudo.body).toBe(
      'Fulana definiu você como responsável por Site institucional.',
    );
    expect(conteudo.link).toBe('/pipeline');
  });

  it('RECORD_ASSIGNED sem autor conhecido (cron) usa a variante impessoal', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'RECORD_ASSIGNED',
        entity: 'TASK',
        entityId: 't1',
        entityLabel: 'Revisar contrato',
      },
      { autorNome: null },
    );

    expect(conteudo.body).toBe(
      'Você foi definido como responsável por Revisar contrato.',
    );
  });

  it('título e corpo são texto puro em pt-BR — nunca tag HTML', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'RECORD_ASSIGNED',
        entity: 'CLIENT',
        entityId: 'c1',
        entityLabel: 'Acme Ltda',
      },
      { autorNome: 'Fulana' },
    );

    expect(conteudo.title).not.toMatch(/<[a-z]/i);
    expect(conteudo.body).not.toMatch(/<[a-z]/i);
  });
});
