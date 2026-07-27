import { WebhookChannel } from './webhook.channel';
import type { ConteudoDeNotificacao } from '../domain/notification-channel';

const CONTEUDO: ConteudoDeNotificacao = {
  tipo: 'TASK_OVERDUE',
  titulo: 'Demanda atrasada',
  corpo: 'A demanda Revisar contrato (Acme) passou do prazo em 20/07/2026.',
  link: '/demandas',
  dados: { titulo: 'Revisar contrato' },
  deliveryId: 'entrega-9',
};

describe('WebhookChannel', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('posta o conteúdo neutro CRU, sem formato de serviço nenhum', async () => {
    const canal = new WebhookChannel();

    await canal.entregar(
      { id: 't1', kind: 'WEBHOOK', config: { url: 'https://n8n.exemplo/x' } },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      tipo: 'TASK_OVERDUE',
      titulo: 'Demanda atrasada',
      corpo: 'A demanda Revisar contrato (Acme) passou do prazo em 20/07/2026.',
      link: '/demandas',
      dados: { titulo: 'Revisar contrato' },
    });
  });

  it('manda os quatro cabeçalhos do CRM', async () => {
    const canal = new WebhookChannel();

    await canal.entregar(
      { id: 't1', kind: 'WEBHOOK', config: { url: 'https://n8n.exemplo/x' } },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-CRM-Delivery']).toBe('entrega-9');
    expect(headers['X-CRM-Timestamp']).toMatch(/^\d+$/);
    expect(headers['User-Agent']).toBe('CRM-ProgrameAi/1.0');
  });

  it('duas entregas da MESMA notificação chegam com o mesmo X-CRM-Delivery', async () => {
    const canal = new WebhookChannel();
    const destino = {
      id: 't1',
      kind: 'WEBHOOK' as const,
      config: { url: 'https://n8n.exemplo/x' },
    };

    await canal.entregar(destino, CONTEUDO);
    await canal.entregar(destino, CONTEUDO); // o retry do outbox

    const cabecalhos = (indice: number) => {
      const [, init] = fetchMock.mock.calls[indice] as [string, RequestInit];
      return init.headers as Record<string, string>;
    };
    expect(cabecalhos(0)['X-CRM-Delivery']).toBe(
      cabecalhos(1)['X-CRM-Delivery'],
    );
  });

  it('rejeita fora da faixa 2xx, com o status na mensagem', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const canal = new WebhookChannel();

    await expect(
      canal.entregar(
        { id: 't1', kind: 'WEBHOOK', config: { url: 'https://n8n.exemplo/x' } },
        CONTEUDO,
      ),
    ).rejects.toThrow('O destino respondeu 503.');
  });

  it('rejeita destino sem URL configurada', async () => {
    const canal = new WebhookChannel();

    await expect(
      canal.entregar({ id: 't1', kind: 'WEBHOOK', config: {} }, CONTEUDO),
    ).rejects.toThrow('Destino de webhook sem URL configurada.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isEnabled é sempre true — a URL vem do destino, não do ambiente', () => {
    expect(new WebhookChannel().isEnabled()).toBe(true);
  });
});
