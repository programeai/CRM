import type { ConfigService } from '@nestjs/config';
import { SlackChannel, escaparMrkdwn } from './slack.channel';
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

describe('escaparMrkdwn', () => {
  it('escapa exatamente os três caracteres que o Slack trata', () => {
    expect(escaparMrkdwn('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('não mexe em asterisco nem underscore (são formatação intencional)', () => {
    expect(escaparMrkdwn('*negrito* _itálico_')).toBe('*negrito* _itálico_');
  });
});

describe('SlackChannel', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('posta no formato mrkdwn, com título em negrito e link absoluto', async () => {
    const canal = new SlackChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'SLACK', config: { url: 'https://hooks.slack.com/x' } },
      CONTEUDO,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.com/x');
    const corpo = JSON.parse(init.body as string) as { text: string };
    expect(corpo.text).toContain('*Cobrança a vencer*');
    expect(corpo.text).toContain(
      '<https://crm.programeai.com.br/financeiro|Abrir no CRM>',
    );
  });

  it('manda o X-CRM-Delivery, que é o que permite deduplicar no retry', async () => {
    const canal = new SlackChannel(configMock());

    await canal.entregar(
      { id: 't1', kind: 'SLACK', config: { url: 'https://hooks.slack.com/x' } },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CRM-Delivery']).toBe('entrega-1');
    expect(headers['X-CRM-Timestamp']).toMatch(/^\d+$/);
  });

  it('rejeita quando o destino responde fora da faixa 2xx, com o status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const canal = new SlackChannel(configMock());

    await expect(
      canal.entregar(
        {
          id: 't1',
          kind: 'SLACK',
          config: { url: 'https://hooks.slack.com/x' },
        },
        CONTEUDO,
      ),
    ).rejects.toThrow('O destino respondeu 404.');
  });

  it('a URL do destino NUNCA entra na mensagem de erro (ela é a credencial)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const canal = new SlackChannel(configMock());
    const url = 'https://hooks.slack.com/services/T000/B000/SEGREDO';

    await expect(
      canal.entregar({ id: 't1', kind: 'SLACK', config: { url } }, CONTEUDO),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('SEGREDO'),
      }) as never,
    );
  });

  it('rejeita destino sem URL configurada', async () => {
    const canal = new SlackChannel(configMock());

    await expect(
      canal.entregar({ id: 't1', kind: 'SLACK', config: {} }, CONTEUDO),
    ).rejects.toThrow('Destino do Slack sem URL configurada.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
