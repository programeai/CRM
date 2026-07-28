import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import type { ActivityRepository } from '../domain/activity.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { CatalogosService } from '../../catalogos/application/catalogos.service';

describe('ActivitiesService', () => {
  let repo: jest.Mocked<ActivityRepository>;
  let clients: jest.Mocked<Pick<ClientsService, 'findOne'>>;
  let members: { assertMember: jest.Mock };
  let notifications: { notificar: jest.Mock };
  let catalogos: { assertUtilizavel: jest.Mock };
  let service: ActivitiesService;

  beforeEach(() => {
    repo = {
      findManyAndCount: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      nextScheduledByDeal: jest.fn(),
    };
    clients = { findOne: jest.fn().mockResolvedValue({ id: 'client-1' }) };
    members = { assertMember: jest.fn().mockResolvedValue(undefined) };
    notifications = { notificar: jest.fn().mockResolvedValue(undefined) };
    catalogos = {
      assertUtilizavel: jest.fn().mockResolvedValue({ id: 'tipo-1' }),
    };
    service = new ActivitiesService(
      repo,
      clients as unknown as ClientsService,
      members as unknown as WorkspaceMembersService,
      notifications as unknown as NotificationsService,
      catalogos as unknown as CatalogosService,
    );
  });

  it('valida o cliente e cria a atividade', async () => {
    repo.create.mockResolvedValue({ id: 'a1' } as never);
    await service.create('owner-1', {
      clientId: 'client-1',
      typeId: 'tipo-1',
      content: 'Contato inicial',
    });
    expect(clients.findOne).toHaveBeenCalledWith('owner-1', 'client-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', typeId: 'tipo-1' }),
    );
  });

  it('indexa a próxima atividade por dealId, repassando o recorte recebido', async () => {
    const proxima = new Date('2026-08-03T13:00:00.000Z');
    const scope = { kind: 'mine', userId: 'u1' } as const;
    repo.nextScheduledByDeal.mockResolvedValue([
      { dealId: 'd1', scheduledFor: proxima },
    ]);

    const mapa = await service.proximaPorDeal('owner-1', ['d1', 'd2'], scope);

    expect(repo.nextScheduledByDeal).toHaveBeenCalledWith(
      'owner-1',
      ['d1', 'd2'],
      scope,
    );
    expect(mapa.get('d1')).toBe(proxima);
    // Deal sem follow-up pendente não vem do repositório e fica fora do mapa.
    expect(mapa.has('d2')).toBe(false);
  });

  it('define completedAt ao concluir uma atividade', async () => {
    repo.findById.mockResolvedValue({
      id: 'a1',
      clientId: 'client-1',
    } as never);
    repo.update.mockResolvedValue({ id: 'a1' } as never);
    await service.complete('owner-1', 'a1');
    expect(repo.update).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ completedAt: expect.any(Date) }),
    );
  });

  it('lança NotFoundException ao concluir atividade inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.complete('owner-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('valida o responsável antes de gravar', async () => {
    members.assertMember.mockRejectedValue(
      new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      ),
    );
    await expect(
      service.create('owner-1', {
        clientId: 'client-1',
        typeId: 'tipo-1',
        content: 'Contato inicial',
        assigneeId: 'de-outro-owner',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('não zera o responsável quando o patch não traz o campo', async () => {
    repo.findById.mockResolvedValue({
      id: 'a1',
      clientId: 'client-1',
    } as never);
    repo.update.mockResolvedValue({ id: 'a1' } as never);
    await service.update('owner-1', 'a1', { content: 'Novo texto' });
    expect(repo.update).toHaveBeenCalledWith(
      'a1',
      expect.not.objectContaining({ assigneeId: expect.anything() }),
    );
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('notifica o novo responsável ao criar já atribuída, com o rótulo truncado em 80', async () => {
    repo.create.mockResolvedValue({
      id: 'a1',
      clientId: 'client-1',
      content: 'x'.repeat(120),
    } as never);

    await service.create('owner-1', {
      clientId: 'client-1',
      typeId: 'tipo-1',
      content: 'x'.repeat(120),
      assigneeId: 'u2',
    });

    expect(notifications.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        evento: expect.objectContaining({
          tipo: 'RECORD_ASSIGNED',
          entity: 'ACTIVITY',
          entityId: 'a1',
          entityLabel: 'x'.repeat(80),
          clientId: 'client-1',
        }),
      }),
    );
  });

  it('notifica quando o responsável muda no update', async () => {
    repo.findById.mockResolvedValue({
      id: 'a1',
      clientId: 'client-1',
      assigneeId: 'u1',
    } as never);
    repo.update.mockResolvedValue({
      id: 'a1',
      clientId: 'client-1',
      content: 'Ligação retornada',
    } as never);

    await service.update('owner-1', 'a1', { assigneeId: 'u2' });

    expect(notifications.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        evento: expect.objectContaining({
          tipo: 'RECORD_ASSIGNED',
          entity: 'ACTIVITY',
        }),
      }),
    );
  });
});
