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

  it('list devolve só os vivos — não existe listar excluídos', async () => {
    repo.findAll.mockResolvedValue([]);
    await service.list('owner-1', 'fontes-de-lead');
    expect(repo.findAll).toHaveBeenCalledWith(
      'fontes-de-lead',
      'owner-1',
      false,
    );
  });

  it('list repassa incluirInativos para o resolvedor de catálogo da importação', async () => {
    repo.findAll.mockResolvedValue([]);
    await service.list('owner-1', 'fontes-de-lead', true);
    expect(repo.findAll).toHaveBeenCalledWith(
      'fontes-de-lead',
      'owner-1',
      true,
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

  it('cadastrar um nome oculto ressuscita a linha em vez de dar 409', async () => {
    // O item ficou `active: false` porque estava em uso quando foi excluído; o
    // `@@unique([ownerId, name])` faria o cadastro bater numa linha invisível.
    repo.findByName.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: false,
    });
    repo.update.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });

    const item = await service.create('owner-1', 'fontes-de-lead', {
      name: 'Indicação',
    });

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      'fontes-de-lead',
      'f1',
      'owner-1',
      {
        active: true,
      },
    );
    // Mesmo id de antes: os registros que já apontavam para ele reencontram.
    expect(item.id).toBe('f1');
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

  it('excluir item EM USO oculta em vez de apagar — as FKs são RESTRICT', async () => {
    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    repo.contarUsos.mockResolvedValue(3);

    const resultado = await service.delete('owner-1', 'fontes-de-lead', 'f1');

    expect(repo.delete).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      'fontes-de-lead',
      'f1',
      'owner-1',
      {
        active: false,
      },
    );
    expect(resultado).toEqual({ ocultado: true, usos: 3 });
  });

  it('excluir item SEM uso apaga de verdade', async () => {
    repo.findById.mockResolvedValue({
      id: 'f1',
      ownerId: 'owner-1',
      name: 'Indicação',
      active: true,
    });
    repo.contarUsos.mockResolvedValue(0);

    const resultado = await service.delete('owner-1', 'fontes-de-lead', 'f1');

    expect(repo.delete).toHaveBeenCalledWith('fontes-de-lead', 'f1', 'owner-1');
    expect(repo.update).not.toHaveBeenCalled();
    expect(resultado).toEqual({ ocultado: false, usos: 0 });
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
