import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { ProjectRepository } from '../domain/project.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { AuditService } from '../../audit/audit.service';

describe('ProjectsService', () => {
  let repo: jest.Mocked<ProjectRepository>;
  let clients: { findOne: jest.Mock };
  let audit: { registrar: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findByClient: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      archive: jest.fn(),
      restore: jest.fn(),
      countTasks: jest.fn(),
      findByDealId: jest.fn(),
    };
    clients = { findOne: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    service = new ProjectsService(
      repo,
      clients as unknown as ClientsService,
      audit as unknown as AuditService,
    );
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

  it('lança NotFoundException ao carregar projeto inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('arquiva o projeto e registra ARQUIVAR na trilha', async () => {
    repo.findById.mockResolvedValue({
      id: 'proj1',
      clientId: 'cli',
      name: 'Site novo',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.archive.mockResolvedValue({
      id: 'proj1',
      archivedAt: new Date(),
    } as never);

    await service.archive('owner', 'proj1');

    expect(repo.archive).toHaveBeenCalledWith('proj1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'PROJECT',
        action: 'ARQUIVAR',
        entityId: 'proj1',
        entityLabel: 'Site novo',
      }),
    );
  });

  it('restaura o projeto buscando com includeArchived e registra RESTAURAR', async () => {
    repo.findById.mockResolvedValue({
      id: 'proj1',
      clientId: 'cli',
      name: 'Site novo',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.restore.mockResolvedValue({
      id: 'proj1',
      archivedAt: null,
    } as never);

    await service.restore('owner', 'proj1');

    expect(repo.findById).toHaveBeenCalledWith('proj1', true);
    expect(repo.restore).toHaveBeenCalledWith('proj1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'PROJECT', action: 'RESTAURAR' }),
    );
  });

  it('lança UnprocessableEntityException ao expurgar projeto ainda ativo', async () => {
    repo.findById.mockResolvedValue({
      id: 'proj1',
      clientId: 'cli',
      name: 'Site novo',
      archivedAt: null,
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.purge('owner', 'proj1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('lança ConflictException ao expurgar projeto arquivado com tarefas', async () => {
    repo.findById.mockResolvedValue({
      id: 'proj1',
      clientId: 'cli',
      name: 'Site novo',
      archivedAt: new Date(),
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.countTasks.mockResolvedValue(2);
    await expect(service.purge('owner', 'proj1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('expurga o projeto arquivado sem tarefas e registra EXPURGAR na trilha', async () => {
    repo.findById.mockResolvedValue({
      id: 'proj1',
      clientId: 'cli',
      name: 'Site novo',
      archivedAt: new Date(),
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.countTasks.mockResolvedValue(0);

    await service.purge('owner', 'proj1');

    expect(repo.delete).toHaveBeenCalledWith('proj1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'PROJECT', action: 'EXPURGAR' }),
    );
  });
});
