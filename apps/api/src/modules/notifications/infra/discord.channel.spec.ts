import type { ConfigService } from '@nestjs/config';
import {
  DiscordChannel,
  escaparMarkdown,
  MAX_CONTENT,
} from './discord.channel';
import type { ConteudoDeNotificacao } from '../domain/notification-channel';

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

describe('escaparMarkdown', () => {
  it('escapa `* _ ~ | ` \\`', () => {
    expect(escaparMarkdown('*a* _b_ ~c~ |d| `e` \\f')).toBe(
      '\\*a\\* \\_b\\_ \\~c\\~ \\|d\\| \\`e\\` \\\\f',
    );
  });

  it('a barra invertida é escapada uma vez só (não vira \\\\\\\\)', () => {
    expect(escaparMarkdown('\\')).toBe('\\\\');
  });

  it('não mexe em texto comum (acento, pontuação, #, @)', () => {
    expect(escaparMarkdown('Ação: R$ 800,00 #tag @fulano')).toBe(
      'Ação: R$ 800,00 #tag @fulano',
    );
  });
});

describe('DiscordChannel', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('posta em `{ content }`, com o título entre `**` e o link entre `<>` absoluto', async () => {
    const canal = new DiscordChannel(configMock());

    await canal.entregar(
      {
        id: 't1',
        kind: 'DISCORD',
        config: { url: 'https://discord.com/api/webhooks/x' },
      },
      CONTEUDO,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/x');
    const corpo = JSON.parse(init.body as string) as { content: string };
    expect(corpo.content).toContain('**Cobrança a vencer**');
    expect(corpo.content).toContain(
      '<https://crm.programeai.com.br/financeiro>',
    );
  });

  it('204 é sucesso, não falha', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    const canal = new DiscordChannel(configMock());

    await expect(
      canal.entregar(
        {
          id: 't1',
          kind: 'DISCORD',
          config: { url: 'https://discord.com/api/webhooks/x' },
        },
        CONTEUDO,
      ),
    ).resolves.toBeUndefined();
  });

  it('manda o X-CRM-Delivery, que é o que permite deduplicar no retry', async () => {
    const canal = new DiscordChannel(configMock());

    await canal.entregar(
      {
        id: 't1',
        kind: 'DISCORD',
        config: { url: 'https://discord.com/api/webhooks/x' },
      },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CRM-Delivery']).toBe('entrega-1');
  });

  it('rejeita quando o destino responde fora da faixa 2xx, com o status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const canal = new DiscordChannel(configMock());

    await expect(
      canal.entregar(
        {
          id: 't1',
          kind: 'DISCORD',
          config: { url: 'https://discord.com/api/webhooks/x' },
        },
        CONTEUDO,
      ),
    ).rejects.toThrow('O destino respondeu 404.');
  });

  it('a URL do destino NUNCA entra na mensagem de erro (ela é a credencial)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const canal = new DiscordChannel(configMock());
    const url = 'https://discord.com/api/webhooks/000/SEGREDO';

    await expect(
      canal.entregar({ id: 't1', kind: 'DISCORD', config: { url } }, CONTEUDO),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('SEGREDO'),
      }) as never,
    );
  });

  it('rejeita destino sem URL configurada, sem chamar o fetch', async () => {
    const canal = new DiscordChannel(configMock());

    await expect(
      canal.entregar({ id: 't1', kind: 'DISCORD', config: {} }, CONTEUDO),
    ).rejects.toThrow('Destino do Discord sem URL configurada.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem link no conteúdo, a mensagem sai com duas linhas e nenhum <>', async () => {
    const canal = new DiscordChannel(configMock());

    await canal.entregar(
      {
        id: 't1',
        kind: 'DISCORD',
        config: { url: 'https://discord.com/api/webhooks/x' },
      },
      { ...CONTEUDO, link: null },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as { content: string };
    expect(corpo.content.split('\n')).toHaveLength(2);
    expect(corpo.content).not.toContain('<');
  });

  it('content maior que 2000 é truncado em 2000', async () => {
    const canal = new DiscordChannel(configMock());

    await canal.entregar(
      {
        id: 't1',
        kind: 'DISCORD',
        config: { url: 'https://discord.com/api/webhooks/x' },
      },
      { ...CONTEUDO, corpo: 'x'.repeat(3000) },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as { content: string };
    expect(corpo.content.length).toBe(MAX_CONTENT);
  });
});
