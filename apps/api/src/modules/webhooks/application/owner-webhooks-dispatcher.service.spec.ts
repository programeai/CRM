import { OwnerWebhooksDispatcherService } from './owner-webhooks-dispatcher.service';
import { BACKOFF_MIN } from '../../../shared/backoff';
import type {
  OwnerWebhookRepository,
  PendingWebhookDelivery,
} from '../domain/owner-webhook.repository';

const SEGREDO = 'whsec_0123456789abcdef';

function pendente(
  overrides: Partial<PendingWebhookDelivery> = {},
): PendingWebhookDelivery {
  return {
    id: 'entrega-1',
    webhookId: 'w1',
    event: 'lead.recebido',
    payload: { evento: 'lead.recebido', dados: { leadNome: 'Ana' } },
    attempts: 0,
    url: 'https://n8n.exemplo/caminho-secreto',
    secret: SEGREDO,
    active: true,
    ...overrides,
  };
}

describe('OwnerWebhooksDispatcherService', () => {
  const fetchOriginal = global.fetch;
  let fetchMock: jest.Mock;
  let repo: jest.Mocked<OwnerWebhookRepository>;
  let service: OwnerWebhooksDispatcherService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
    repo = {
      marcarEnviada: jest.fn().mockResolvedValue(undefined),
      marcarFalha: jest.fn().mockResolvedValue(undefined),
      touchPeloSistema: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OwnerWebhookRepository>;
    service = new OwnerWebhooksDispatcherService(repo);
    errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('entrega o payload assinado e marca a entrega e o webhook', async () => {
    const r = await service.despacharLote([pendente()]);

    expect(r).toEqual({ entregues: 1, falhas: 0, puladas: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://n8n.exemplo/caminho-secreto');
    const headers = init.headers as Record<string, string>;
    // O webhook do owner SEMPRE tem segredo: a assinatura nunca é opcional aqui.
    expect(headers['X-CRM-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['X-CRM-Delivery']).toBe('entrega-1');
    expect(repo.marcarEnviada).toHaveBeenCalledWith(
      'entrega-1',
      expect.any(Date),
    );
    // `lastUsedAt` só no sucesso: é ele que responde "este endereço está vivo?".
    expect(repo.touchPeloSistema).toHaveBeenCalledWith('w1');
  });

  it('uma entrega que falha não derruba as outras do lote', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const r = await service.despacharLote([
      pendente({ id: 'e1' }),
      pendente({ id: 'e2' }),
    ]);

    expect(r).toEqual({ entregues: 1, falhas: 1, puladas: 0 });
  });

  it('aplica o backoff compartilhado e reagenda a tentativa seguinte', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await service.despacharLote([pendente({ attempts: 0 })]);

    const [, attempts, proxima] = repo.marcarFalha.mock.calls[0];
    expect(attempts).toBe(1);
    // BACKOFF_MIN[0] = 1 minuto.
    expect(proxima).toBeInstanceOf(Date);
    expect((proxima as Date).getTime() - Date.now()).toBeGreaterThan(
      (BACKOFF_MIN[0] - 1) * 60_000,
    );
  });

  it('esgota depois da última posição do backoff: `proxima` nula = FAILED definitivo', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    // `attempts` já em 5 → a 6ª tentativa é a última, e não há BACKOFF_MIN[5].
    await service.despacharLote([pendente({ attempts: BACKOFF_MIN.length })]);

    const [, attempts, proxima] = repo.marcarFalha.mock.calls[0];
    expect(attempts).toBe(BACKOFF_MIN.length + 1);
    expect(proxima).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: 'webhook.entrega_falhou',
        definitiva: true,
      }),
    );
  });

  /*
    `lastError` é GRAVADO NO BANCO e pode acabar num log: nem o segredo nem a URL
    podem chegar lá.
  */
  it('lastError nunca contém o segredo nem a URL', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await service.despacharLote([pendente()]);

    const [, , , erro] = repo.marcarFalha.mock.calls[0];
    expect(erro).toBe('O destino respondeu 503.');
    expect(erro).not.toContain(SEGREDO);
    expect(erro).not.toContain('n8n.exemplo');
    expect(erro).not.toContain('caminho-secreto');
  });

  it('nem o log de falha carrega segredo, URL ou payload', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await service.despacharLote([pendente()]);

    const linhas = JSON.stringify(errorSpy.mock.calls);
    expect(linhas).not.toContain(SEGREDO);
    expect(linhas).not.toContain('n8n.exemplo');
    expect(linhas).not.toContain('Ana');
  });

  /*
    O webhook pode ter sido desativado ENTRE a emissão e a entrega. Desistir é o
    comportamento certo: quem desligou não quer que a fila continue saindo.
  */
  it('desiste da entrega de webhook desativado, sem POST e em definitivo', async () => {
    const r = await service.despacharLote([pendente({ active: false })]);

    expect(r).toEqual({ entregues: 0, falhas: 0, puladas: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.marcarFalha).toHaveBeenCalledWith(
      'entrega-1',
      0,
      null,
      'Webhook desativado antes da entrega.',
    );
  });
});
