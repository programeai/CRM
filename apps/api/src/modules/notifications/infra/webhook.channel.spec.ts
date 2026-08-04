import { createHmac } from 'node:crypto';
import { WebhookChannel } from './webhook.channel';
import type { ConteudoDeNotificacao } from '../domain/notification-channel';

const SEGREDO = 'whsec_0123456789abcdef0123456789abcdef';

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

  /*
    A assinatura é ADITIVA (issue #26): destino SEM segredo continua com os
    quatro cabeçalhos de antes da 19-B, e é isso que mantém Slack, Discord,
    Telegram e todo webhook cadastrado antes dela entregando sem mudança.
  */
  it('destino SEM segredo: manda os quatro cabeçalhos do CRM e nenhuma assinatura', async () => {
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
    expect(headers['X-CRM-Signature']).toBeUndefined();
    expect(Object.keys(headers)).toHaveLength(4);
  });

  it('destino COM segredo: acrescenta X-CRM-Signature, preservando os quatro', async () => {
    const canal = new WebhookChannel();

    await canal.entregar(
      {
        id: 't1',
        kind: 'WEBHOOK',
        config: { url: 'https://n8n.exemplo/x', secret: SEGREDO },
      },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-CRM-Delivery']).toBe('entrega-9');
    expect(headers['X-CRM-Timestamp']).toMatch(/^\d+$/);
    expect(headers['User-Agent']).toBe('CRM-ProgrameAi/1.0');
    expect(headers['X-CRM-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(Object.keys(headers)).toHaveLength(5);
  });

  /*
    O teste que pega RESERIALIZAÇÃO: recalcula o HMAC sobre o `body` que foi de
    fato postado, não sobre um objeto remontado no spec. Se alguém voltar a
    serializar dentro da chamada do `fetch`, a assinatura deixa de casar com o
    corpo enviado e este caso quebra.
  */
  it('a assinatura casa com o HMAC do corpo REALMENTE postado', async () => {
    const canal = new WebhookChannel();

    await canal.entregar(
      {
        id: 't1',
        kind: 'WEBHOOK',
        config: { url: 'https://n8n.exemplo/x', secret: SEGREDO },
      },
      CONTEUDO,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const esperado = createHmac('sha256', SEGREDO)
      .update(`${headers['X-CRM-Timestamp']}.${init.body as string}`)
      .digest('hex');
    expect(headers['X-CRM-Signature']).toBe(`sha256=${esperado}`);
  });

  it('segredo diferente produz assinatura diferente para o mesmo corpo', async () => {
    const canal = new WebhookChannel();
    const destino = (secret: string) => ({
      id: 't1',
      kind: 'WEBHOOK' as const,
      config: { url: 'https://n8n.exemplo/x', secret },
    });

    await canal.entregar(destino(SEGREDO), CONTEUDO);
    await canal.entregar(destino('whsec_outro'), CONTEUDO);

    const assinatura = (i: number) => {
      const [, init] = fetchMock.mock.calls[i] as [string, RequestInit];
      return (init.headers as Record<string, string>)['X-CRM-Signature'];
    };
    expect(assinatura(0)).not.toBe(assinatura(1));
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

  /*
    `lastError` do outbox é GRAVADO NO BANCO e pode acabar num log: nem o segredo
    nem a URL podem chegar lá (issue #26, propriedade 2).
  */
  it('a mensagem de erro de uma falha 503 não contém o segredo nem a URL', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const canal = new WebhookChannel();

    const mensagem = await canal
      .entregar(
        {
          id: 't1',
          kind: 'WEBHOOK',
          config: {
            url: 'https://n8n.exemplo/caminho-secreto',
            secret: SEGREDO,
          },
        },
        CONTEUDO,
      )
      .catch((erro: Error) => erro.message);

    expect(mensagem).toBe('O destino respondeu 503.');
    expect(mensagem).not.toContain(SEGREDO);
    expect(mensagem).not.toContain('n8n.exemplo');
    expect(mensagem).not.toContain('caminho-secreto');
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
