import { NotificationsDispatcherService } from './notifications-dispatcher.service';
import type { CanalDeNotificacao } from '../domain/notification-channel';
import type {
  NotificationRepository,
  PendingDelivery,
} from '../domain/notification.repository';

function pendente(overrides: Partial<PendingDelivery> = {}): PendingDelivery {
  return {
    id: 'entrega-1',
    ownerId: 'owner-1',
    notificationId: 'n1',
    userId: 'u1',
    createdAt: new Date(),
    targetId: 'target-1',
    kind: 'IN_APP',
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date(),
    lastError: null,
    sentAt: null,
    readAt: null,
    notification: {
      id: 'n1',
      ownerId: 'owner-1',
      userId: 'u1',
      type: 'RECORD_ASSIGNED',
      entity: 'DEAL',
      entityId: 'd1',
      title: 'Título',
      body: 'Corpo',
      link: null,
      data: null,
      dedupeKey: null,
      createdAt: new Date(),
    },
    target: { id: 'target-1', kind: 'IN_APP', config: {} },
    ...overrides,
  };
}

describe('NotificationsDispatcherService', () => {
  let repo: jest.Mocked<
    Pick<
      NotificationRepository,
      'marcarEnviada' | 'marcarPulada' | 'marcarFalha'
    >
  >;

  beforeEach(() => {
    repo = {
      marcarEnviada: jest.fn().mockResolvedValue(undefined),
      marcarPulada: jest.fn().mockResolvedValue(undefined),
      marcarFalha: jest.fn().mockResolvedValue(undefined),
    };
  });

  function makeCanal(
    kind: CanalDeNotificacao['kind'],
    overrides: Partial<CanalDeNotificacao> = {},
  ): CanalDeNotificacao {
    return {
      kind,
      isEnabled: () => true,
      entregar: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('canal não registrado → SKIPPED', async () => {
    const service = new NotificationsDispatcherService(
      [],
      repo as unknown as NotificationRepository,
    );

    const r = await service.despacharLote([pendente({ kind: 'WEBHOOK' })]);

    expect(r).toEqual({ entregues: 0, falhas: 0, puladas: 1 });
    expect(repo.marcarPulada).toHaveBeenCalledWith(
      'entrega-1',
      'Canal não registrado.',
    );
  });

  it('isEnabled() === false → SKIPPED, e o entregar não é chamado', async () => {
    const canal = makeCanal('EMAIL', { isEnabled: () => false });
    const service = new NotificationsDispatcherService(
      [canal],
      repo as unknown as NotificationRepository,
    );

    const r = await service.despacharLote([pendente({ kind: 'EMAIL' })]);

    expect(r.puladas).toBe(1);
    expect(canal.entregar).not.toHaveBeenCalled();
    expect(repo.marcarPulada).toHaveBeenCalledWith(
      'entrega-1',
      'Canal desabilitado por configuração.',
    );
  });

  it('destino nulo (apagado depois da emissão) → SKIPPED', async () => {
    const canal = makeCanal('IN_APP');
    const service = new NotificationsDispatcherService(
      [canal],
      repo as unknown as NotificationRepository,
    );

    const r = await service.despacharLote([pendente({ target: null })]);

    expect(r.puladas).toBe(1);
    expect(canal.entregar).not.toHaveBeenCalled();
    expect(repo.marcarPulada).toHaveBeenCalledWith(
      'entrega-1',
      'Destino removido.',
    );
  });

  it('sucesso → marcarEnviada', async () => {
    const canal = makeCanal('IN_APP');
    const service = new NotificationsDispatcherService(
      [canal],
      repo as unknown as NotificationRepository,
    );

    const r = await service.despacharLote([pendente()]);

    expect(r).toEqual({ entregues: 1, falhas: 0, puladas: 0 });
    expect(repo.marcarEnviada).toHaveBeenCalledWith(
      'entrega-1',
      expect.any(Date),
    );
  });

  it('falha na 1ª tentativa → marcarFalha com nextAttemptAt ≈ +1min e status seguindo PENDING', async () => {
    const canal = makeCanal('WEBHOOK', {
      entregar: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const service = new NotificationsDispatcherService(
      [canal],
      repo as unknown as NotificationRepository,
    );

    const antes = Date.now();
    const r = await service.despacharLote([
      pendente({ kind: 'WEBHOOK', attempts: 0 }),
    ]);

    expect(r.falhas).toBe(1);
    const [, attempts, nextAttemptAt] = repo.marcarFalha.mock.calls[0];
    expect(attempts).toBe(1);
    expect(nextAttemptAt).not.toBeNull();
    expect((nextAttemptAt as Date).getTime() - antes).toBeGreaterThanOrEqual(
      59_000,
    );
    expect((nextAttemptAt as Date).getTime() - antes).toBeLessThanOrEqual(
      61_000,
    );
  });

  it('falha depois de esgotar o backoff → nextAttemptAt: null (FAILED definitivo)', async () => {
    // BACKOFF_MIN tem 5 posições ([1,5,30,120,480]); a 6ª falha (attempts vai a
    // 6) não encontra mais espera na tabela — é aí que a entrega desiste de vez.
    const canal = makeCanal('WEBHOOK', {
      entregar: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const service = new NotificationsDispatcherService(
      [canal],
      repo as unknown as NotificationRepository,
    );

    await service.despacharLote([pendente({ kind: 'WEBHOOK', attempts: 5 })]);

    expect(repo.marcarFalha).toHaveBeenCalledWith(
      'entrega-1',
      6,
      null,
      expect.any(String),
    );
  });

  it('um destino que rejeita não impede o outro de ser entregue', async () => {
    const canalFalha = makeCanal('WEBHOOK', {
      entregar: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const canalOk = makeCanal('IN_APP');
    const service = new NotificationsDispatcherService(
      [canalFalha, canalOk],
      repo as unknown as NotificationRepository,
    );

    const r = await service.despacharLote([
      pendente({ id: 'e1', kind: 'WEBHOOK' }),
      pendente({ id: 'e2', kind: 'IN_APP' }),
    ]);

    expect(r).toEqual({ entregues: 1, falhas: 1, puladas: 0 });
    expect(repo.marcarEnviada).toHaveBeenCalledWith('e2', expect.any(Date));
  });

  it('o lastError é truncado em 500 caracteres', async () => {
    const mensagemGigante = 'x'.repeat(1000);
    const canal = makeCanal('WEBHOOK', {
      entregar: jest.fn().mockRejectedValue(new Error(mensagemGigante)),
    });
    const service = new NotificationsDispatcherService(
      [canal],
      repo as unknown as NotificationRepository,
    );

    await service.despacharLote([pendente({ kind: 'WEBHOOK' })]);

    const [, , , erro] = repo.marcarFalha.mock.calls[0];
    expect(erro.length).toBe(500);
  });
});
