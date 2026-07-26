import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PipelineStagesService } from './pipeline-stages.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

describe('PipelineStagesService', () => {
  let repo: jest.Mocked<PipelineStageRepository>;
  let service: PipelineStagesService;

  beforeEach(() => {
    repo = {
      findAllOrdered: jest.fn(),
      findAllIds: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxOrder: jest.fn(),
      countDeals: jest.fn(),
      reorder: jest.fn(),
    };
    service = new PipelineStagesService(repo);
  });

  it('cria estágio no fim da ordem do owner', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.maxOrder.mockResolvedValue(4);
    repo.create.mockResolvedValue({ id: 's1' } as never);
    await service.create('owner', { name: 'Qualificação' });
    expect(repo.maxOrder).toHaveBeenCalledWith('owner');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner',
        name: 'Qualificação',
        order: 5,
        isWon: false,
        isLost: false,
      }),
    );
  });

  it('rejeita nome duplicado no mesmo owner com ConflictException', async () => {
    repo.findByName.mockResolvedValue({ id: 's9' } as never);
    await expect(
      service.create('owner', { name: 'Ganhou' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.findByName).toHaveBeenCalledWith('owner', 'Ganhou');
  });

  it('lança NotFoundException ao buscar estágio inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findById).toHaveBeenCalledWith('nope', 'owner');
  });

  it('impede excluir estágio com oportunidades', async () => {
    repo.findById.mockResolvedValue({ id: 's1' } as never);
    repo.countDeals.mockResolvedValue(3);
    await expect(service.delete('owner', 's1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('não vê estágio de outro owner (findById escopado)', async () => {
    repo.findById.mockResolvedValue(null); // RLS/where devolvem null p/ outro owner
    await expect(
      service.findOne('owner-a', 'stage-do-owner-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reordena quando a lista é permutação exata dos estágios do owner', async () => {
    repo.findAllIds.mockResolvedValue(['a', 'b', 'c']);
    repo.findAllOrdered.mockResolvedValue([] as never);
    await service.reorder('owner', ['c', 'a', 'b']);
    expect(repo.reorder).toHaveBeenCalledWith('owner', ['c', 'a', 'b']);
  });

  it('rejeita reorder com id fora do funil do owner', async () => {
    repo.findAllIds.mockResolvedValue(['a', 'b', 'c']);
    await expect(
      service.reorder('owner', ['a', 'b', 'de-outro-owner']),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.reorder).not.toHaveBeenCalled();
  });
});
