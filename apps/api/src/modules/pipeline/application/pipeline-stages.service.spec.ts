import { ConflictException, NotFoundException } from '@nestjs/common';
import { PipelineStagesService } from './pipeline-stages.service';
import type { PipelineStageRepository } from '../domain/pipeline-stage.repository';

describe('PipelineStagesService', () => {
  let repo: jest.Mocked<PipelineStageRepository>;
  let service: PipelineStagesService;

  beforeEach(() => {
    repo = {
      findAllOrdered: jest.fn(),
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

  it('cria estágio no fim da ordem', async () => {
    repo.findByName.mockResolvedValue(null);
    repo.maxOrder.mockResolvedValue(4);
    repo.create.mockResolvedValue({ id: 's1' } as never);
    await service.create({ name: 'Qualificação' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Qualificação',
        order: 5,
        isWon: false,
        isLost: false,
      }),
    );
  });

  it('rejeita nome duplicado com ConflictException', async () => {
    repo.findByName.mockResolvedValue({ id: 's9' } as never);
    await expect(service.create({ name: 'Ganhou' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lança NotFoundException ao buscar estágio inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('impede excluir estágio com oportunidades', async () => {
    repo.findById.mockResolvedValue({ id: 's1' } as never);
    repo.countDeals.mockResolvedValue(3);
    await expect(service.delete('s1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
