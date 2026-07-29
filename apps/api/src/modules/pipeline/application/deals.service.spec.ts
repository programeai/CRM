import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DealsService } from './deals.service';
import type { DealRepository } from '../domain/deal.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { ActivitiesService } from '../../activities/application/activities.service';
import type { PipelineStagesService } from './pipeline-stages.service';
import type { ProjectsService } from '../../projects/application/projects.service';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import type { AuditService } from '../../audit/audit.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { CatalogosService } from '../../catalogos/application/catalogos.service';

describe('DealsService', () => {
  let repo: jest.Mocked<DealRepository>;
  let clients: { findOne: jest.Mock; promoverParaAtivo: jest.Mock };
  let activities: { proximaPorDeal: jest.Mock };
  let stages: { findOne: jest.Mock; firstStage: jest.Mock };
  let projects: { createFromDeal: jest.Mock };
  let members: { assertMember: jest.Mock };
  let audit: { registrar: jest.Mock };
  let notifications: { notificar: jest.Mock };
  let catalogos: { assertUtilizavel: jest.Mock };
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
      archive: jest.fn(),
      restore: jest.fn(),
    };
    clients = {
      findOne: jest.fn(),
      promoverParaAtivo: jest.fn().mockResolvedValue(undefined),
    };
    activities = { proximaPorDeal: jest.fn().mockResolvedValue(new Map()) };
    stages = { findOne: jest.fn(), firstStage: jest.fn() };
    projects = { createFromDeal: jest.fn() };
    members = { assertMember: jest.fn().mockResolvedValue(undefined) };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    notifications = { notificar: jest.fn().mockResolvedValue(undefined) };
    catalogos = {
      assertUtilizavel: jest.fn().mockResolvedValue({ id: 'motivo-1' }),
    };
    service = new DealsService(
      repo,
      clients as unknown as ClientsService,
      activities as unknown as ActivitiesService,
      stages as unknown as PipelineStagesService,
      projects as unknown as ProjectsService,
      members as unknown as WorkspaceMembersService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      catalogos as unknown as CatalogosService,
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
    expect(stages.firstStage).toHaveBeenCalledWith('owner');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 'stage-0', position: 3 }),
    );
  });

  it('anexa nextActivityAt a cada card do quadro, null quando não há follow-up', async () => {
    const proxima = new Date('2026-08-03T13:00:00.000Z');
    repo.findAllForBoard.mockResolvedValue([
      { id: 'd1', title: 'Com follow-up' },
      { id: 'd2', title: 'Sem follow-up' },
    ] as never);
    activities.proximaPorDeal.mockResolvedValue(new Map([['d1', proxima]]));

    const cards = await service.board('owner');

    expect(cards).toEqual([
      { id: 'd1', title: 'Com follow-up', nextActivityAt: proxima },
      { id: 'd2', title: 'Sem follow-up', nextActivityAt: null },
    ]);
    // Uma consulta agregada para o quadro inteiro — não uma por card.
    expect(activities.proximaPorDeal).toHaveBeenCalledTimes(1);
    expect(activities.proximaPorDeal).toHaveBeenCalledWith(
      'owner',
      ['d1', 'd2'],
      { kind: 'all' },
    );
  });

  it('recorta o nextActivityAt pelo escopo de atividade, não pelo de oportunidade', async () => {
    repo.findAllForBoard.mockResolvedValue([{ id: 'd1' }] as never);
    const escopoOportunidade = { kind: 'all' } as const;
    const escopoAtividade = { kind: 'mine', userId: 'u1' } as const;

    await service.board(
      'owner',
      escopoOportunidade,
      undefined,
      escopoAtividade,
    );

    expect(repo.findAllForBoard).toHaveBeenCalledWith(
      'owner',
      escopoOportunidade,
      undefined,
    );
    expect(activities.proximaPorDeal).toHaveBeenCalledWith(
      'owner',
      ['d1'],
      escopoAtividade,
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

  it('rejeita motivo de perda excluído (ou de outro owner) ao mover para isLost', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'perdeu', isLost: true });
    catalogos.assertUtilizavel.mockRejectedValue(
      new UnprocessableEntityException(
        'Este motivo de perda foi excluído. Escolha outro ou cadastre-o novamente.',
      ),
    );
    await expect(
      service.move('owner', 'd1', {
        stageId: 'perdeu',
        position: 0,
        lostReasonId: 'motivo-desativado',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.move).not.toHaveBeenCalled();
  });

  it('grava o motivo validado ao mover para isLost', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'perdeu', isLost: true });
    repo.move.mockResolvedValue({ id: 'd1' } as never);

    await service.move('owner', 'd1', {
      stageId: 'perdeu',
      position: 0,
      lostReasonId: 'motivo-1',
    });

    expect(catalogos.assertUtilizavel).toHaveBeenCalledWith(
      'owner',
      'motivos-de-perda',
      'motivo-1',
    );
    expect(repo.move).toHaveBeenCalledWith(
      'd1',
      'perdeu',
      0,
      expect.objectContaining({ lostReasonId: 'motivo-1' }),
    );
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
        lostReasonId: null,
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

  it('ganhar promove o cliente a ativo, no mesmo gatilho do projeto', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({ id: 'won', isWon: true, isLost: false });
    repo.move.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 'won',
    } as never);

    await service.move('owner', 'd1', { stageId: 'won', position: 0 });

    expect(clients.promoverParaAtivo).toHaveBeenCalledWith('owner', 'cli');
  });

  it('perder NÃO mexe no status do cliente — ele pode ter outros negócios', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      stageId: 's1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.findOne.mockResolvedValue({
      id: 'lost',
      isWon: false,
      isLost: true,
    });
    repo.move.mockResolvedValue({ id: 'd1', clientId: 'cli' } as never);

    await service.move('owner', 'd1', {
      stageId: 'lost',
      position: 0,
      lostReasonId: 'motivo-1',
    });

    expect(clients.promoverParaAtivo).not.toHaveBeenCalled();
  });

  it('valida o responsável antes de gravar', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    members.assertMember.mockRejectedValue(
      new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      ),
    );
    await expect(
      service.create('owner', {
        title: 'Projeto X',
        clientId: 'cli',
        serviceType: 'SOFTWARE',
        assigneeId: 'de-outro-owner',
      } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('não zera o responsável quando o patch não traz o campo', async () => {
    repo.findById.mockResolvedValue({ id: 'd1', clientId: 'cli' } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'd1' } as never);
    await service.update('owner', 'd1', { title: 'Novo' });
    expect(repo.update).toHaveBeenCalledWith(
      'd1',
      expect.not.objectContaining({ assigneeId: expect.anything() }),
    );
    expect(notifications.notificar).not.toHaveBeenCalled();
  });

  it('notifica o novo responsável ao criar já atribuído', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    stages.firstStage.mockResolvedValue({ id: 'stage-0', isLost: false });
    repo.maxPositionInStage.mockResolvedValue(-1);
    repo.create.mockResolvedValue({ id: 'd1', title: 'Projeto X' } as never);

    await service.create('owner', {
      title: 'Projeto X',
      clientId: 'cli',
      serviceType: 'SOFTWARE',
      assigneeId: 'u2',
    } as never);

    expect(notifications.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        evento: expect.objectContaining({
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: 'd1',
          entityLabel: 'Projeto X',
        }),
      }),
    );
  });

  it('notifica quando o responsável muda no update', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      assigneeId: 'u1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'd1', title: 'Projeto X' } as never);

    await service.update('owner', 'd1', { assigneeId: 'u2' });

    expect(notifications.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        evento: expect.objectContaining({
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
        }),
      }),
    );
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

  it('arquiva o deal e registra ARQUIVAR na trilha', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      title: 'Site novo',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.archive.mockResolvedValue({
      id: 'd1',
      archivedAt: new Date(),
    } as never);

    await service.archive('owner', 'd1');

    expect(repo.archive).toHaveBeenCalledWith('d1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'DEAL',
        action: 'ARQUIVAR',
        entityId: 'd1',
        entityLabel: 'Site novo',
      }),
    );
  });

  it('restaura o deal buscando com includeArchived e registra RESTAURAR', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      title: 'Site novo',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.restore.mockResolvedValue({ id: 'd1', archivedAt: null } as never);

    await service.restore('owner', 'd1');

    expect(repo.findById).toHaveBeenCalledWith('d1', expect.anything(), true);
    expect(repo.restore).toHaveBeenCalledWith('d1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'DEAL', action: 'RESTAURAR' }),
    );
  });

  it('lança UnprocessableEntityException ao expurgar deal ainda ativo', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      title: 'Site novo',
      archivedAt: null,
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.purge('owner', 'd1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao expurgar deal de outro owner', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.purge('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('expurga o deal arquivado e registra EXPURGAR na trilha', async () => {
    repo.findById.mockResolvedValue({
      id: 'd1',
      clientId: 'cli',
      title: 'Site novo',
      archivedAt: new Date(),
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });

    await service.purge('owner', 'd1');

    expect(repo.delete).toHaveBeenCalledWith('d1');
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'DEAL', action: 'EXPURGAR' }),
    );
  });
});
