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

  it('LEAD_RECEIVED cita o cenário e aponta para o cadastro do lead', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'LEAD_RECEIVED',
        entityId: 'c1',
        leadNome: 'Ana Ribeiro',
        origem: 'site-institucional',
        cenario: 'Operação no limite',
      },
      { autorNome: null },
    );

    expect(conteudo.title).toBe('Lead novo');
    expect(conteudo.body).toBe(
      'Ana Ribeiro chegou por site-institucional. Cenário: Operação no limite.',
    );
    expect(conteudo.link).toBe('/clientes/c1');
  });

  it('LEAD_RECEIVED sem cenário fecha a frase na origem', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'LEAD_RECEIVED',
        entityId: 'c1',
        leadNome: 'Ana Ribeiro',
        origem: 'landing-agenda-cheia',
      },
      { autorNome: null },
    );

    expect(conteudo.body).toBe('Ana Ribeiro chegou por landing-agenda-cheia.');
  });

  it('LEAD_RECEIVED reincidente muda o título e avisa do cadastro anterior', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'LEAD_RECEIVED',
        entityId: 'c1',
        leadNome: 'Ana Ribeiro',
        origem: 'site-institucional',
        reincidente: true,
      },
      { autorNome: null },
    );

    expect(conteudo.title).toBe('Lead voltou a procurar');
    expect(conteudo.body).toBe(
      'Ana Ribeiro chegou por site-institucional. Já havia um cadastro com este contato.',
    );
  });

  it('DEAL_STALE diz o estágio e desde quando, e abre o quadro', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'DEAL_STALE',
        entityId: 'd1',
        titulo: 'Site institucional',
        clienteNome: 'Acme',
        estagio: 'Negociação',
        dataAlvo: new Date('2026-08-01T12:00:00.000Z'),
      },
      { autorNome: null },
    );

    expect(conteudo.title).toBe('Oportunidade esfriando');
    expect(conteudo.body).toBe(
      'A oportunidade Site institucional (Acme) está parada em Negociação desde 01/08/2026.',
    );
    expect(conteudo.entity).toBe('DEAL');
    expect(conteudo.link).toBe('/pipeline');
  });

  it('DEAL_STALE não escreve número de dias no corpo (a janela é do backend)', () => {
    const conteudo = montarConteudo(
      {
        tipo: 'DEAL_STALE',
        entityId: 'd1',
        titulo: 'Site institucional',
        clienteNome: 'Acme',
        estagio: 'Negociação',
        dataAlvo: new Date('2026-08-01T12:00:00.000Z'),
      },
      { autorNome: null },
    );

    expect(conteudo.body).not.toMatch(/\d+\s*dias/);
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
