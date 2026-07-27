import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import type { ClientRepository } from '../domain/client.repository';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import type { AuditService } from '../../audit/audit.service';

describe('ClientsService', () => {
  let repo: jest.Mocked<ClientRepository>;
  let members: jest.Mocked<WorkspaceMembersService>;
  let audit: { registrar: jest.Mock };
  let service: ClientsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      existsByDocument: jest.fn(),
      listOwnerTags: jest.fn(),
      findByTag: jest.fn(),
      removeTagFromAll: jest.fn(),
    };
    members = {
      list: jest.fn(),
      assertMember: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WorkspaceMembersService>;
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    service = new ClientsService(
      repo,
      members,
      audit as unknown as AuditService,
    );
  });

  it('registra o arquivamento na trilha de auditoria', async () => {
    repo.findById.mockResolvedValue({ id: 'c1', name: 'Acme' } as never);
    repo.archive.mockResolvedValue({ id: 'c1' } as never);

    await service.archive('owner-1', 'c1');

    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'CLIENT',
        action: 'ARQUIVAR',
        entityId: 'c1',
        entityLabel: 'Acme',
      }),
    );
  });

  it('cria cliente derivando ownerId e limpando o documento', async () => {
    repo.existsByDocument.mockResolvedValue(false);
    repo.create.mockResolvedValue({ id: 'c1' } as never);
    await service.create('owner-1', {
      name: 'Acme',
      personType: 'COMPANY',
      document: '11.222.333/0001-81',
    } as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        document: '11222333000181',
      }),
    );
  });

  it('rejeita documento inválido com BadRequestException', async () => {
    await expect(
      service.create('owner-1', {
        name: 'X',
        personType: 'INDIVIDUAL',
        document: '123',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita documento duplicado com ConflictException', async () => {
    repo.existsByDocument.mockResolvedValue(true);
    await expect(
      service.create('owner-1', {
        name: 'X',
        personType: 'INDIVIDUAL',
        document: '390.533.447-05',
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lança NotFoundException ao buscar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lança NotFoundException ao atualizar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.update('owner-1', 'nope', { name: 'Novo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança NotFoundException ao arquivar id inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.archive('owner-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('passa skip/take corretos ao repo na paginação', async () => {
    repo.findManyAndCount.mockResolvedValue({ data: [], total: 0 });
    await service.list('owner-1', { page: 3, limit: 10 });
    expect(repo.findManyAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1', skip: 20, take: 10 }),
    );
  });

  // O create faz spread do DTO: sem a validação explícita, `assigneeId` chegaria
  // ao Prisma sem passar por lugar nenhum.
  it('valida o responsável antes de gravar', async () => {
    members.assertMember.mockRejectedValue(
      new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      ),
    );
    await expect(
      service.create('owner-1', {
        name: 'Acme',
        personType: 'COMPANY',
        assigneeId: 'de-outro-owner',
      } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('não zera o responsável quando o patch não traz o campo', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      personType: 'COMPANY',
    } as never);
    repo.update.mockResolvedValue({ id: 'c1' } as never);
    await service.update('owner-1', 'c1', { name: 'Novo' });
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      'owner-1',
      expect.not.objectContaining({ assigneeId: expect.anything() }),
    );
  });
});
