import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CatalogosService } from './catalogos.service';
import type { CatalogRepository } from '../domain/catalog.repository';

describe('CatalogosService', () => {
  let repo: jest.Mocked<CatalogRepository>;
  let service: CatalogosService;

  beforeEach(() => {
    repo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      contarUsos: jest.fn(),
      desmarcarOutrosFollowUp: jest.fn(),
    };
    service = new CatalogosService(repo);
  });

  it('list sem incluirInativos repassa false ao repositório', async () => {
    repo.findAll.mockResolvedValue([]);
    await service.list('owner-1', 'fontes-de-lead');
    expect(repo.findAll).toHaveBeenCalledWith(
      'fontes-de-lead',
      'owner-1',
      false,
    );
  });

  it('rejeita nome duplicado no create com ConflictException', async () => {
    repo.findByName.mockResolvedValue({
      id: 'x',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    await expect(
      service.create('owner-1', 'fontes-de-lead', { name: 'Indicação' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('trima o nome antes de checar duplicidade e de criar', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.create.mockResolvedValue({
      id: 'novo',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    await service.create('owner-1', 'fontes-de-lead', {
      name: '  Indicação  ',
    });
    expect(repo.findByName).toHaveBeenCalledWith(
      'fontes-de-lead',
      'owner-1',
      'Indicação',
    );
    expect(repo.create).toHaveBeenCalledWith('fontes-de-lead', {
      ownerId: 'owner-1',
      name: 'Indicação',
    });
  });

  it('rejeita nome duplicado no update apenas quando o nome muda', async () => {
    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    repo.findByName.mockResolvedValue(null);
    repo.update.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: false,
    });

    // Mesmo nome: não dispara checagem de duplicidade.
    await service.update('owner-1', 'fontes-de-lead', 'f1', { active: false });
    expect(repo.findByName).not.toHaveBeenCalled();

    repo.findByName.mockResolvedValue({
      id: 'outro',
      ownerId: 'owner-1',
      name: 'Orgânico',
      active: true,
    });
    await expect(
      service.update('owner-1', 'fontes-de-lead', 'f1', { name: 'Orgânico' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lança NotFoundException para item de outro owner (repositório devolve null)', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.findOne('owner-1', 'fontes-de-lead', 'de-outro-owner'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertUtilizavel rejeita item desativado com UnprocessableEntityException', async () => {
    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: false,
    });
    await expect(
      service.assertUtilizavel('owner-1', 'fontes-de-lead', 'f1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('assertUtilizavel devolve o item quando ativo', async () => {
    const item = {
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    };
    repo.findById.mockResolvedValue(item);
    await expect(
      service.assertUtilizavel('owner-1', 'fontes-de-lead', 'f1'),
    ).resolves.toEqual(item);
  });

  it('impede excluir item em uso com ConflictException citando a contagem', async () => {
    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    repo.contarUsos.mockResolvedValue(3);
    await expect(
      service.delete('owner-1', 'fontes-de-lead', 'f1'),
    ).rejects.toThrow(/3 registro\(s\)/);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('exclui item sem uso', async () => {
    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    repo.contarUsos.mockResolvedValue(0);
    await service.delete('owner-1', 'fontes-de-lead', 'f1');
    expect(repo.delete).toHaveBeenCalledWith('fontes-de-lead', 'f1', 'owner-1');
  });

  it('rejeita isFollowUp em kind diferente de tipos-de-atividade com 422', async () => {
    await expect(
      service.create('owner-1', 'fontes-de-lead', {
        name: 'Indicação',
        isFollowUp: true,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();

    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    await expect(
      service.update('owner-1', 'fontes-de-lead', 'f1', { isFollowUp: false }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('create com isFollowUp em tipos-de-atividade chama desmarcarOutrosFollowUp', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.create.mockResolvedValue({
      id: 'novo',
      ownerId: 'owner-1',
      name: 'Follow-up',
      active: true,
      isFollowUp: true,
    });
    await service.create('owner-1', 'tipos-de-atividade', {
      name: 'Follow-up',
      isFollowUp: true,
    });
    expect(repo.desmarcarOutrosFollowUp).toHaveBeenCalledWith(
      'owner-1',
      'novo',
    );
  });

  it('update com isFollowUp em tipos-de-atividade chama desmarcarOutrosFollowUp', async () => {
    repo.findById.mockResolvedValue({
      id: 'a1',
      ownerId: 'owner-1',
      name: 'Ligação',
      active: true,
      isFollowUp: false,
    });
    repo.update.mockResolvedValue({
      id: 'a1',
      ownerId: 'owner-1',
      name: 'Ligação',
      active: true,
      isFollowUp: true,
    });
    await service.update('owner-1', 'tipos-de-atividade', 'a1', {
      isFollowUp: true,
    });
    expect(repo.desmarcarOutrosFollowUp).toHaveBeenCalledWith('owner-1', 'a1');
  });
});
