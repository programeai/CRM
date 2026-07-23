import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { ProjectRepository } from '../domain/project.repository';
import type { ClientsService } from '../../clients/application/clients.service';

describe('ProjectsService', () => {
  let repo: jest.Mocked<ProjectRepository>;
  let clients: { findOne: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findByClient: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countTasks: jest.fn(),
    };
    clients = { findOne: jest.fn() };
    service = new ProjectsService(repo, clients as unknown as ClientsService);
  });

  it('valida posse do cliente e repassa datas convertidas ao criar', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.create.mockResolvedValue({ id: 'proj1' } as never);
    await service.create('owner', {
      name: 'Site novo',
      clientId: 'cli',
      serviceType: 'WEBSITE',
      startDate: '2026-08-01',
      dueDate: '2026-09-01',
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner', 'cli');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'cli',
        name: 'Site novo',
        serviceType: 'WEBSITE',
        startDate: new Date('2026-08-01'),
        dueDate: new Date('2026-09-01'),
      }),
    );
  });

  it('lança ConflictException ao excluir projeto com tarefas', async () => {
    repo.findById.mockResolvedValue({ id: 'proj1', clientId: 'cli' } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.countTasks.mockResolvedValue(2);
    await expect(service.delete('owner', 'proj1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao carregar projeto inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
