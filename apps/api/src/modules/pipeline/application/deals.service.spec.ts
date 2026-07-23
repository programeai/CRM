import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DealsService } from './deals.service';
import type { DealRepository } from '../domain/deal.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { PipelineStagesService } from './pipeline-stages.service';
import type { ProjectsService } from '../../projects/application/projects.service';

describe('DealsService', () => {
  let repo: jest.Mocked<DealRepository>;
  let clients: { findOne: jest.Mock };
  let stages: { findOne: jest.Mock; firstStage: jest.Mock };
  let projects: { createFromDeal: jest.Mock };
  let service: DealsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findAllForBoard: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxPositionInStage: jest.fn(),
      move: jest.fn(),
    };
    clients = { findOne: jest.fn() };
    stages = { findOne: jest.fn(), firstStage: jest.fn() };
    projects = { createFromDeal: jest.fn() };
    service = new DealsService(
      repo,
      clients as unknown as ClientsService,
      stages as unknown as PipelineStagesService,
      projects as unknown as ProjectsService,
    );
  });

  it('cria deal no fim do estágio padrão, validando posse do cliente', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.firstStage.mockResolvedValue({ id: 'stage-0', isLost: false });
    repo.maxPositionInStage.mockResolvedValue(2);
    repo.create.mockResolvedValue({ id: 'd1' } as never);
    await service.create('owner', {
      title: 'Projeto X',
      clientId: 'cli',
      serviceType: 'SOFTWARE',
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner', 'cli');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 'stage-0', position: 3 }),
    );
  });

  it('lança NotFoundException ao carregar deal inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('exige motivo de perda ao mover para estágio isLost', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'perdeu', isLost: true });
    await expect(
      service.move('owner', 'd1', { stageId: 'perdeu', position: 0 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.move).not.toHaveBeenCalled();
  });

  it('atualiza stageMovedAt ao mudar de estágio', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 's2', isLost: false });
    repo.move.mockResolvedValue({ id: 'd1' } as never);
    await service.move('owner', 'd1', { stageId: 's2', position: 0 });
    expect(repo.move).toHaveBeenCalledWith(
      'd1',
      's2',
      0,
      expect.objectContaining({
        stageMovedAt: expect.any(Date),
        lostReason: null,
      }),
    );
    expect(projects.createFromDeal).not.toHaveBeenCalled();
  });

  it('cria o projeto ao mover para um estágio isWon com mudança de estágio', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'won', isWon: true, isLost: false });
    repo.move.mockResolvedValue({ id: 'd1', stageId: 'won' } as never);
    await service.move('owner', 'd1', { stageId: 'won', position: 0 });
    expect(projects.createFromDeal).toHaveBeenCalledWith({
      id: 'd1',
      stageId: 'won',
    });
  });

  it('não cria o projeto ao mover dentro do mesmo estágio isWon (sem mudança)', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 'won',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'won', isWon: true, isLost: false });
    repo.move.mockResolvedValue({ id: 'd1', stageId: 'won' } as never);
    await service.move('owner', 'd1', { stageId: 'won', position: 1 });
    expect(projects.createFromDeal).not.toHaveBeenCalled();
  });
});
