import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import type { ActivityRepository } from '../domain/activity.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';

describe('ActivitiesService', () => {
  let repo: jest.Mocked<ActivityRepository>;
  let clients: jest.Mocked<Pick<ClientsService, 'findOne'>>;
  let members: { assertMember: jest.Mock };
  let service: ActivitiesService;

  beforeEach(() => {
    repo = {
      findManyAndCount: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    clients = { findOne: jest.fn().mockResolvedValue({ id: 'client-1' }) };
    members = { assertMember: jest.fn().mockResolvedValue(undefined) };
    service = new ActivitiesService(
      repo,
      clients as unknown as ClientsService,
      members as unknown as WorkspaceMembersService,
    );
  });

  it('valida o cliente e cria a atividade', async () => {
    repo.create.mockResolvedValue({ id: 'a1' } as never);
    await service.create('owner-1', {
      clientId: 'client-1',
      type: 'NOTE',
      content: 'Contato inicial',
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner-1', 'client-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', type: 'NOTE' }),
    );
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
        type: 'NOTE',
        content: 'Contato inicial',
        assigneeId: 'de-outro-owner',
      } as never),
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
  });
});
