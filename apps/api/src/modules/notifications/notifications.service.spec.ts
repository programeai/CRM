import { NotificationsService } from './notifications.service';
import {
  ACCESS_CONTEXT,
  type AccessContext,
} from '../access/domain/access-context';
import type { NotificationRepository } from './domain/notification.repository';
import type { NotificationTargetRepository } from './domain/notification-target.repository';

const ACCESS: AccessContext = {
  userId: 'u1',
  userName: 'Fulana',
  ownerId: 'owner-1',
  isOwner: false,
  roleId: 'r1',
  roleName: 'Comercial',
  permissions: [],
};

describe('NotificationsService', () => {
  let repo: jest.Mocked<
    Pick<NotificationRepository, 'criar' | 'criarPeloSistema'>
  >;
  let targets: jest.Mocked<
    Pick<
      NotificationTargetRepository,
      'findElegiveis' | 'findElegiveisPeloSistema'
    >
  >;
  let cls: { get: jest.Mock; getId: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    repo = {
      criar: jest.fn().mockResolvedValue(undefined),
      criarPeloSistema: jest.fn().mockResolvedValue(undefined),
    };
    targets = {
      findElegiveis: jest.fn().mockResolvedValue([]),
      findElegiveisPeloSistema: jest.fn().mockResolvedValue([]),
    };
    cls = { get: jest.fn(), getId: jest.fn().mockReturnValue('req-1') };
    service = new NotificationsService(
      repo as unknown as NotificationRepository,
      targets as unknown as NotificationTargetRepository,
      cls as never,
    );
  });

  describe('notificar', () => {
    it('sem AccessContext no CLS, não grava e emite notificacao.sem_contexto', async () => {
      cls.get.mockReturnValue(undefined);
      const warnSpy = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await service.notificar({
        userId: 'u2',
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          entityLabel: 'Site novo',
        },
      });

      expect(repo.criar).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'notificacao.sem_contexto' }),
      );
    });

    it('destinatário igual ao autor não gera nada, e nem consulta os destinos', async () => {
      cls.get.mockReturnValue(ACCESS);

      await service.notificar({
        userId: ACCESS.userId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          entityLabel: 'Site novo',
        },
      });

      expect(targets.findElegiveis).not.toHaveBeenCalled();
      expect(repo.criar).not.toHaveBeenCalled();
    });

    it('sem destino elegível, não cria linha nenhuma', async () => {
      cls.get.mockReturnValue(ACCESS);
      targets.findElegiveis.mockResolvedValue([]);

      await service.notificar({
        userId: 'u2',
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          entityLabel: 'Site novo',
        },
      });

      expect(repo.criar).not.toHaveBeenCalled();
    });

    it('com dois destinos, cria uma Notification com duas deliveries aninhadas, com o userName do CLS no corpo', async () => {
      cls.get.mockReturnValue(ACCESS);
      targets.findElegiveis.mockResolvedValue([
        { id: 't1', kind: 'IN_APP' },
        { id: 't2', kind: 'EMAIL' },
      ] as never);

      await service.notificar({
        userId: 'u2',
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          entityLabel: 'Site novo',
        },
      });

      expect(cls.get).toHaveBeenCalledWith(ACCESS_CONTEXT);
      expect(repo.criar).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          userId: 'u2',
          type: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          title: expect.any(String),
          body: 'Fulana definiu você como responsável por Site novo.',
          dedupeKey: null,
          deliveries: {
            create: [
              {
                ownerId: 'owner-1',
                userId: 'u2',
                targetId: 't1',
                kind: 'IN_APP',
              },
              {
                ownerId: 'owner-1',
                userId: 'u2',
                targetId: 't2',
                kind: 'EMAIL',
              },
            ],
          },
        }),
      );
    });

    it('não propaga a exceção do create e emite notificacao.emissao_falhou', async () => {
      cls.get.mockReturnValue(ACCESS);
      targets.findElegiveis.mockResolvedValue([
        { id: 't1', kind: 'IN_APP' },
      ] as never);
      repo.criar.mockRejectedValue(new Error('falhou'));
      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.notificar({
          userId: 'u2',
          evento: {
            tipo: 'RECORD_ASSIGNED',
            entity: 'DEAL',
            entityId: 'd1',
            entityLabel: 'Site novo',
          },
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'notificacao.emissao_falhou' }),
        expect.any(String),
      );
    });
  });

  describe('notificarPeloSistema', () => {
    it('usa o client admin, grava o dedupeKey e produz o corpo impessoal', async () => {
      targets.findElegiveisPeloSistema.mockResolvedValue([
        { id: 't1', kind: 'IN_APP' },
      ] as never);

      await service.notificarPeloSistema({
        ownerId: 'owner-2',
        userId: 'u3',
        dedupeKey: 'RECORD_ASSIGNED:d1',
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          entityLabel: 'Site novo',
        },
      });

      expect(targets.findElegiveisPeloSistema).toHaveBeenCalledWith(
        'owner-2',
        'u3',
        'RECORD_ASSIGNED',
      );
      expect(repo.criarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-2',
          userId: 'u3',
          dedupeKey: 'RECORD_ASSIGNED:d1',
          body: 'Você foi definido como responsável por Site novo.',
        }),
      );
    });

    it('engole P2002 sem logar erro (dedupe não é falha)', async () => {
      targets.findElegiveisPeloSistema.mockResolvedValue([
        { id: 't1', kind: 'IN_APP' },
      ] as never);
      repo.criarPeloSistema.mockRejectedValue(
        Object.assign(new Error('unique violation'), { code: 'P2002' }),
      );
      const errorSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.notificarPeloSistema({
          ownerId: 'owner-2',
          userId: 'u3',
          dedupeKey: 'RECORD_ASSIGNED:d1',
          evento: {
            tipo: 'RECORD_ASSIGNED',
            entity: 'DEAL',
            entityId: 'd1',
            entityLabel: 'Site novo',
          },
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
