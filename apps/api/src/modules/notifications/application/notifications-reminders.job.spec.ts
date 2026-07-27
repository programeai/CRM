import { NotificationsRemindersJob } from './notifications-reminders.job';
import type {
  AlvoDeLembrete,
  NotificationTriggersRepository,
} from '../domain/notification-triggers.repository';
import type { NotificationRepository } from '../domain/notification.repository';
import type { NotificationsService } from '../notifications.service';

function alvo(overrides: Partial<AlvoDeLembrete> = {}): AlvoDeLembrete {
  return {
    ownerId: 'owner-1',
    userId: 'u1',
    entityId: 'e1',
    label: 'Rótulo',
    clienteNome: 'Acme',
    dataAlvo: new Date('2026-08-01T12:00:00.000Z'),
    clientId: 'c1',
    ...overrides,
  };
}

describe('NotificationsRemindersJob', () => {
  let triggers: jest.Mocked<NotificationTriggersRepository>;
  let repo: jest.Mocked<Pick<NotificationRepository, 'dedupeKeysExistentes'>>;
  let notifications: { notificarPeloSistema: jest.Mock };
  let job: NotificationsRemindersJob;

  beforeEach(() => {
    triggers = {
      followUpsDoDia: jest.fn().mockResolvedValue([]),
      propostasAExpirar: jest.fn().mockResolvedValue([]),
      cobrancasAVencer: jest.fn().mockResolvedValue([]),
      demandasAtrasadas: jest.fn().mockResolvedValue([]),
    };
    repo = { dedupeKeysExistentes: jest.fn().mockResolvedValue(new Set()) };
    notifications = {
      notificarPeloSistema: jest.fn().mockResolvedValue(undefined),
    };
    job = new NotificationsRemindersJob(
      triggers,
      repo as unknown as NotificationRepository,
      notifications as unknown as NotificationsService,
    );
  });

  it('consulta os quatro gatilhos e emite um lembrete por alvo', async () => {
    triggers.followUpsDoDia.mockResolvedValue([alvo({ entityId: 'a1' })]);
    triggers.propostasAExpirar.mockResolvedValue([alvo({ entityId: 'p1' })]);
    triggers.cobrancasAVencer.mockResolvedValue([
      alvo({ entityId: 'pay1', valor: 800 }),
    ]);
    triggers.demandasAtrasadas.mockResolvedValue([alvo({ entityId: 't1' })]);

    await job.run();

    expect(triggers.followUpsDoDia).toHaveBeenCalled();
    expect(triggers.propostasAExpirar).toHaveBeenCalled();
    expect(triggers.cobrancasAVencer).toHaveBeenCalled();
    expect(triggers.demandasAtrasadas).toHaveBeenCalled();
    expect(notifications.notificarPeloSistema).toHaveBeenCalledTimes(4);
  });

  it('a janela dos gatilhos com antecedência é recalculada a partir de agora', async () => {
    const antes = Date.now();
    await job.run();

    const [de, ate] = triggers.cobrancasAVencer.mock.calls[0];
    // 3 dias de antecedência, sem fake timers — mede a diferença, não a data.
    const dias = (ate.getTime() - de.getTime()) / 86_400_000;
    expect(dias).toBeCloseTo(3, 1);
    expect(de.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('alvo cujo dedupeKey já existe não é emitido de novo', async () => {
    triggers.cobrancasAVencer.mockResolvedValue([
      alvo({ entityId: 'pay1', valor: 800 }),
    ]);
    repo.dedupeKeysExistentes.mockResolvedValue(
      new Set(['PAYMENT_DUE:pay1:2026-08-01']),
    );

    await job.run();

    expect(notifications.notificarPeloSistema).not.toHaveBeenCalled();
  });

  it('o dedupeKey composto carrega o tipo, o id e a data-alvo em ISO curto', async () => {
    triggers.cobrancasAVencer.mockResolvedValue([
      alvo({ entityId: 'pay1', valor: 800 }),
    ]);

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'PAYMENT_DUE:pay1:2026-08-01' }),
    );
  });

  it('uma emissão que lança não interrompe o restante do lote', async () => {
    triggers.demandasAtrasadas.mockResolvedValue([
      alvo({ entityId: 't1' }),
      alvo({ entityId: 't2' }),
      alvo({ entityId: 't3' }),
    ]);
    notifications.notificarPeloSistema
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('caiu'))
      .mockResolvedValueOnce(undefined);
    jest
      .spyOn(
        (job as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledTimes(3);
  });

  it('lote vazio não emite o log agregado (guard > 0)', async () => {
    const logSpy = jest
      .spyOn((job as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);

    await job.run();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('com alvos, emite o log agregado com a quantidade', async () => {
    triggers.demandasAtrasadas.mockResolvedValue([
      alvo({ entityId: 't1' }),
      alvo({ entityId: 't2' }),
    ]);
    const logSpy = jest
      .spyOn((job as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);

    await job.run();

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: 'notificacoes.lembretes_emitidos',
        quantidade: 2,
      }),
    );
  });

  it('o pré-filtro de dedupe é por usuário — a mesma chave pode faltar só para um', async () => {
    triggers.demandasAtrasadas.mockResolvedValue([
      alvo({ entityId: 't1', userId: 'u1' }),
      alvo({ entityId: 't1', userId: 'u2' }),
    ]);
    repo.dedupeKeysExistentes.mockImplementation((userId: string) =>
      Promise.resolve(
        userId === 'u1' ? new Set(['TASK_OVERDUE:t1:2026-08-01']) : new Set(),
      ),
    );

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledTimes(1);
    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2' }),
    );
  });
});
