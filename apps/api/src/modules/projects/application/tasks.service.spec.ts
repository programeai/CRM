import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import type { TaskRepository } from '../domain/task.repository';
import type { ProjectsService } from './projects.service';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';

describe('TasksService', () => {
  let repo: jest.Mocked<TaskRepository>;
  let projects: { findOne: jest.Mock };
  let members: { assertMember: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findAllForBoard: jest.fn(),
      findAllForBoardByOwner: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxPositionInStatus: jest.fn(),
      move: jest.fn(),
    };
    projects = { findOne: jest.fn() };
    members = { assertMember: jest.fn().mockResolvedValue(undefined) };
    service = new TasksService(
      repo,
      projects as unknown as ProjectsService,
      members as unknown as WorkspaceMembersService,
    );
  });

  it('calcula position = max+1 e seta completedAt só quando status === DONE', async () => {
    projects.findOne.mockResolvedValue({ id: 'proj1' });
    repo.maxPositionInStatus.mockResolvedValue(1);
    repo.create.mockResolvedValue({ id: 't1' } as never);
    await service.create('owner', {
      projectId: 'proj1',
      title: 'Tarefa X',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        position: 2,
        status: 'BACKLOG',
        completedAt: null,
      }),
    );

    repo.maxPositionInStatus.mockResolvedValue(-1);
    await service.create('owner', {
      projectId: 'proj1',
      title: 'Tarefa concluída',
      status: 'DONE',
    } as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        position: 0,
        status: 'DONE',
        completedAt: expect.any(Date),
      }),
    );
  });

  it('move para DONE seta completedAt; sair de DONE limpa; mesmo status sem DONE não mexe', async () => {
    repo.findById.mockResolvedValue({
      id: 't1',
      projectId: 'proj1',
      status: 'TODO',
    } as never);
    projects.findOne.mockResolvedValue({ id: 'proj1' });
    repo.move.mockResolvedValue({ id: 't1' } as never);
    await service.move('owner', 't1', { status: 'DONE', position: 0 });
    expect(repo.move).toHaveBeenCalledWith(
      't1',
      'DONE',
      0,
      expect.objectContaining({ completedAt: expect.any(Date) }),
    );

    repo.findById.mockResolvedValue({
      id: 't1',
      projectId: 'proj1',
      status: 'DONE',
    } as never);
    await service.move('owner', 't1', { status: 'TODO', position: 0 });
    expect(repo.move).toHaveBeenCalledWith('t1', 'TODO', 0, {
      completedAt: null,
    });

    repo.findById.mockResolvedValue({
      id: 't1',
      projectId: 'proj1',
      status: 'TODO',
    } as never);
    await service.move('owner', 't1', { status: 'IN_PROGRESS', position: 1 });
    expect(repo.move).toHaveBeenCalledWith('t1', 'IN_PROGRESS', 1, {});
  });

  it('lança NotFoundException ao carregar tarefa inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('valida o responsável antes de gravar', async () => {
    projects.findOne.mockResolvedValue({ id: 'proj1' });
    members.assertMember.mockRejectedValue(
      new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      ),
    );
    await expect(
      service.create('owner', {
        projectId: 'proj1',
        title: 'Tarefa X',
        assigneeId: 'de-outro-owner',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('não zera o responsável quando o patch não traz o campo', async () => {
    repo.findById.mockResolvedValue({ id: 't1', projectId: 'proj1' } as never);
    projects.findOne.mockResolvedValue({ id: 'proj1' });
    repo.update.mockResolvedValue({ id: 't1' } as never);
    await service.update('owner', 't1', { title: 'Novo' });
    expect(repo.update).toHaveBeenCalledWith(
      't1',
      expect.not.objectContaining({ assigneeId: expect.anything() }),
    );
  });
});
