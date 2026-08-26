import { montarAtribuicao, temAtribuicao } from './atribuicao-de-anuncio';

describe('montarAtribuicao', () => {
  const AGORA = new Date('2026-08-05T12:00:00.000Z');

  it('devolve tudo nulo quando nada vem — o caso de hoje', () => {
    const a = montarAtribuicao({}, AGORA);

    expect(a).toEqual({
      fbclid: null,
      fbclidAt: null,
      fbp: null,
      gclid: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      landingUrl: null,
    });
  });

  it('temAtribuicao é false para o conjunto vazio', () => {
    expect(temAtribuicao(montarAtribuicao({}, AGORA))).toBe(false);
    // E true com um campo só: é o que abre a escrita.
    expect(
      temAtribuicao(montarAtribuicao({ utmSource: 'facebook' }, AGORA)),
    ).toBe(true);
  });

  it('estampa fbclidAt a partir de recebidoEm, em milissegundos', () => {
    const a = montarAtribuicao(
      { fbclid: 'IwAR2F4', recebidoEm: '2026-08-04T17:32:00.123Z' },
      AGORA,
    );
    expect(a.fbclidAt?.getTime()).toBe(
      new Date('2026-08-04T17:32:00.123Z').getTime(),
    );
  });

  it('cai em agora quando recebidoEm falta ou é ilegível', () => {
    expect(montarAtribuicao({ fbclid: 'IwAR2F4' }, AGORA).fbclidAt).toEqual(
      AGORA,
    );
    expect(
      montarAtribuicao(
        { fbclid: 'IwAR2F4', recebidoEm: 'ontem de manhã' },
        AGORA,
      ).fbclidAt,
    ).toEqual(AGORA);
  });

  it('NÃO normaliza a caixa do fbclid', () => {
    expect(
      montarAtribuicao({ fbclid: ' IwAR2F4-dbP0l7Mn ' }, AGORA).fbclid,
    ).toBe('IwAR2F4-dbP0l7Mn'); // só o espaço saiu
  });

  it('fbclidAt é nulo quando não há fbclid, mesmo com recebidoEm', () => {
    const a = montarAtribuicao(
      { utmSource: 'facebook', recebidoEm: '2026-08-04T17:32:00.123Z' },
      AGORA,
    );
    expect(a.fbclid).toBeNull();
    expect(a.fbclidAt).toBeNull();
  });

  it('string vazia e só-espaço viram null, nunca ""', () => {
    const a = montarAtribuicao(
      { fbclid: '', fbp: '   ', gclid: null, utmSource: '  ' },
      AGORA,
    );
    expect(a.fbclid).toBeNull();
    expect(a.fbclidAt).toBeNull();
    expect(a.fbp).toBeNull();
    expect(a.gclid).toBeNull();
    expect(a.utmSource).toBeNull();
    expect(temAtribuicao(a)).toBe(false);
  });

  it('urlDeEntrada vira landingUrl', () => {
    const a = montarAtribuicao(
      {
        urlDeEntrada:
          'https://programeai.com.br/agenda-cheia?utm_source=facebook',
      },
      AGORA,
    );
    expect(a.landingUrl).toBe(
      'https://programeai.com.br/agenda-cheia?utm_source=facebook',
    );
  });
});
