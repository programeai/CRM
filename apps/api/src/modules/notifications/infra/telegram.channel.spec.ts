import type { ConfigService } from '@nestjs/config';
import {
  MAX_TEXT,
  TelegramChannel,
  escaparHtml,
  extrairChatId,
} from './telegram.channel';
import type { ConteudoDeNotificacao } from '../domain/notification-channel';

const URL_DESTINO =
  'https://api.telegram.org/bot123456:SEGREDO/sendMessage?chat_id=-100999';

const CONTEUDO: ConteudoDeNotificacao = {
  tipo: 'PAYMENT_DUE',
  titulo: 'Cobrança a vencer',
  corpo: 'Mensalidade 08/2026 de Acme, R$ 800,00, vence em 01/08/2026.',
  link: '/financeiro',
  dados: null,
  deliveryId: 'entrega-1',
};

function configMock(frontendUrl = 'https://crm.programeai.com.br') {
  return { get: () => frontendUrl } as unknown as ConfigService;
}

/** Resposta de sucesso do Telegram: HTTP 200 e `ok: true` no corpo. */
function respostaOk() {
  return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
}

describe('escaparHtml', () => {
  it('escapa os três caracteres que abrem tag ou entidade', () => {
    expect(escaparHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('escapa o & primeiro, senão as entidades novas seriam reescapadas', () => {
    expect(escaparHtml('<b>')).toBe('&lt;b&gt;');
  });

  it('não mexe em asterisco nem underscore (não formatam no modo HTML)', () => {
    expect(escaparHtml('*a* _b_ #tag @fulano')).toBe('*a* _b_ #tag @fulano');
  });
});

describe('extrairChatId', () => {
  it('devolve o chat_id e a URL sem a query', () => {
    expect(extrairChatId(URL_DESTINO)).toEqual({
      endpoint: 'https://api.telegram.org/bot123456:SEGREDO/sendMessage',
      chatId: '-100999',
    });
  });

  it('rejeita URL sem chat_id', () => {
    expect(() =>
      extrairChatId('https://api.telegram.org/bot123:X/sendMessage'),
    ).toThrow('Destino do Telegram sem chat_id configurado.');
  });
});

describe('TelegramChannel', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(respostaOk());
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('posta chat_id no CORPO e a URL sem query, com título em <b> e link mascarado', async () => {
    const canal = new TelegramChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
      CONTEUDO,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // A query saiu da URL: a doc não garante misturar query string com corpo JSON.
    expect(url).toBe('https://api.telegram.org/bot123456:SEGREDO/sendMessage');
    const corpo = JSON.parse(init.body as string) as {
      chat_id: string;
      text: string;
      parse_mode: string;
      link_preview_options: { is_disabled: boolean };
    };
    expect(corpo.chat_id).toBe('-100999');
    expect(corpo.parse_mode).toBe('HTML');
    expect(corpo.link_preview_options).toEqual({ is_disabled: true });
    expect(corpo.text).toContain('<b>Cobrança a vencer</b>');
    expect(corpo.text).toContain(
      '<a href="https://crm.programeai.com.br/financeiro">Abrir no CRM</a>',
    );
  });

  it('REJEITA quando o corpo traz ok:false, mesmo com HTTP 200', async () => {
    // O caso que justifica este canal não reusar o `postar()`: sem ler o corpo,
    // um token inválido viraria entrega concluída e o outbox nem tentaria de novo.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: false, description: 'Unauthorized' }),
    });
    const canal = new TelegramChannel(configMock());

    await expect(
      canal.entregar(
        { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
        CONTEUDO,
      ),
    ).rejects.toThrow('O Telegram recusou a mensagem: Unauthorized');
  });

  it('rejeita fora da faixa 2xx, com o status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ ok: false }),
    });
    const canal = new TelegramChannel(configMock());

    await expect(
      canal.entregar(
        { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
        CONTEUDO,
      ),
    ).rejects.toThrow('O destino respondeu 400.');
  });

  it('a URL do destino NUNCA entra na mensagem de erro (ela carrega o token)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: false, description: 'chat not found' }),
    });
    const canal = new TelegramChannel(configMock());

    await expect(
      canal.entregar(
        { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
        CONTEUDO,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('SEGREDO'),
      }) as never,
    );
  });

  it('manda o X-CRM-Delivery, que é o que permite deduplicar no retry', async () => {
    const canal = new TelegramChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CRM-Delivery']).toBe('entrega-1');
  });

  it('rejeita destino sem URL configurada, sem chamar o fetch', async () => {
    const canal = new TelegramChannel(configMock());

    await expect(
      canal.entregar({ id: 't1', kind: 'TELEGRAM', config: {} }, CONTEUDO),
    ).rejects.toThrow('Destino do Telegram sem URL configurada.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem link no conteúdo, o texto sai com duas linhas e nenhuma âncora', async () => {
    const canal = new TelegramChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
      { ...CONTEUDO, link: null },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as { text: string };
    expect(corpo.text.split('\n')).toHaveLength(2);
    expect(corpo.text).not.toContain('<a href');
  });

  it('texto maior que o teto é truncado', async () => {
    const canal = new TelegramChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
      { ...CONTEUDO, corpo: 'x'.repeat(MAX_TEXT + 500) },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as { text: string };
    expect(corpo.text.length).toBe(MAX_TEXT);
  });

  it('escapa o corpo: nome de cliente com < > não injeta tag', async () => {
    const canal = new TelegramChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'TELEGRAM', config: { url: URL_DESTINO } },
      { ...CONTEUDO, corpo: 'Cliente <b>Acme</b>' },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as { text: string };
    expect(corpo.text).toContain('Cliente &lt;b&gt;Acme&lt;/b&gt;');
  });
});
