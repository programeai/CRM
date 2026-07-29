import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import type { ProposalRepository } from '../domain/proposal.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { DealsService } from '../../pipeline/application/deals.service';
import type { PipelineStagesService } from '../../pipeline/application/pipeline-stages.service';
import type { AuditService } from '../../audit/audit.service';
import type { CatalogosService } from '../../catalogos/application/catalogos.service';

describe('ProposalsService', () => {
  let repo: jest.Mocked<ProposalRepository>;
  let clients: { findOne: jest.Mock; promoverParaAtivo: jest.Mock };
  let deals: { findOne: jest.Mock; move: jest.Mock; board: jest.Mock };
  let stages: { wonStage: jest.Mock };
  let audit: { registrar: jest.Mock };
  let catalogos: { assertUtilizavel: jest.Mock; findOne: jest.Mock };
  let service: ProposalsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      updateWithItems: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      maxSequenceForYear: jest.fn(),
      findVersionsByNumber: jest.fn(),
      expireOverdue: jest.fn(),
    };
    clients = {
      findOne: jest.fn(),
      promoverParaAtivo: jest.fn().mockResolvedValue(undefined),
    };
    deals = { findOne: jest.fn(), move: jest.fn(), board: jest.fn() };
    stages = { wonStage: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    catalogos = {
      assertUtilizavel: jest.fn().mockResolvedValue({ id: 'svc-1' }),
      findOne: jest.fn().mockResolvedValue({ id: 'svc-1' }),
    };
    service = new ProposalsService(
      repo,
      clients as unknown as ClientsService,
      deals as unknown as DealsService,
      stages as unknown as PipelineStagesService,
      audit as unknown as AuditService,
      catalogos as unknown as CatalogosService,
    );
  });

  it('gera número sequencial do ano e valida posse ao criar', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.maxSequenceForYear.mockResolvedValue(41);
    repo.create.mockResolvedValue({ id: 'p1' } as never);
    await service.create('owner', {
      clientId: 'cli',
      serviceType: 'SOFTWARE',
      items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
      billingType: 'ONE_TIME',
      startOffsetDays: 0,
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner', 'cli');
    const year = new Date().getFullYear();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        number: `PROP-${year}-0042`,
        total: 100,
        status: 'DRAFT',
      }),
    );
  });

  it('create persiste as 8 colunas do plano de cobrança', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.maxSequenceForYear.mockResolvedValue(0);
    repo.create.mockResolvedValue({ id: 'p1' } as never);
    await service.create('owner', {
      clientId: 'cli',
      serviceType: 'SOFTWARE',
      items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
      billingType: 'INSTALLMENTS',
      startOffsetDays: 30,
      installments: 8,
      downPaymentPercent: 30,
      downPaymentOffsetDays: 5,
    } as never);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        billingType: 'INSTALLMENTS',
        startOffsetDays: 30,
        billingDay: null,
        durationMonths: null,
        downPaymentPercent: 30,
        downPaymentAmount: null,
        downPaymentOffsetDays: 5,
        installments: 8,
      }),
    );
  });

  it('create rejeita plano incoerente antes de tocar o repo', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.maxSequenceForYear.mockResolvedValue(0);
    await expect(
      service.create('owner', {
        clientId: 'cli',
        serviceType: 'SOFTWARE',
        items: [{ description: 'A', quantity: 1, unitPrice: 100 }],
        billingType: 'RECURRING',
        startOffsetDays: 0,
        // sem billingDay: incoerente para RECURRING
      } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao carregar proposta inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('bloqueia edição fora de DRAFT', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(
      service.update('owner', 'p1', { scope: 'x' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('update sem billingType não manda nenhuma coluna de plano ao repo', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'DRAFT',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1' } as never);
    await service.update('owner', 'p1', { scope: 'novo escopo' });
    expect(repo.update).toHaveBeenCalledWith(
      'p1',
      expect.not.objectContaining({ billingType: expect.anything() }),
    );
  });

  it('update com billingType e sem o obrigatório do regime lança 422', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'DRAFT',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(
      service.update('owner', 'p1', {
        billingType: 'INSTALLMENTS',
        startOffsetDays: 10,
        // sem installments: incoerente para INSTALLMENTS
      } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateWithItems).not.toHaveBeenCalled();
  });

  it('bloqueia exclusão fora de DRAFT', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'ACCEPTED',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.delete('owner', 'p1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('recusa aceitar direto de DRAFT (transição inválida)', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'DRAFT',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.accept('owner', 'p1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('aceita de SENT, seta decidedAt e move o deal para Ganhou', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
      dealId: 'd1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' } as never);
    stages.wonStage.mockResolvedValue({ id: 'won', isWon: true });
    deals.board.mockResolvedValue([{ id: 'd1', stageId: 's1' }]);
    await service.accept('owner', 'p1');
    expect(repo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'ACCEPTED' }),
    );
    expect(stages.wonStage).toHaveBeenCalledWith('owner');
    expect(deals.move).toHaveBeenCalledWith('owner', 'd1', {
      stageId: 'won',
      position: 0,
    });
  });

  it('aceite promove o cliente a ativo mesmo SEM oportunidade vinculada', async () => {
    // Sem `dealId` nada passa por `DealsService.move`, que é o outro ponto de
    // promoção — é justamente o caso que o caminho do deal não cobre.
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
      dealId: null,
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' } as never);

    await service.accept('owner', 'p1');

    expect(deals.move).not.toHaveBeenCalled();
    expect(clients.promoverParaAtivo).toHaveBeenCalledWith('owner', 'cli');
  });

  it('recusar não promove o cliente', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
      dealId: null,
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'REJECTED' } as never);

    await service.reject('owner', 'p1');

    expect(clients.promoverParaAtivo).not.toHaveBeenCalled();
  });

  it('envia de DRAFT setando sentAt; enviar de novo é transição inválida', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'DRAFT',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'SENT' } as never);
    await service.send('owner', 'p1');
    expect(repo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }),
    );

    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
    } as never);
    await expect(service.send('owner', 'p1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('cria nova versão com mesmo number, version+1, parentId e clona o plano campo a campo', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
      number: 'PROP-2026-0001',
      version: 1,
      dealId: null,
      serviceType: 'SOFTWARE',
      scope: null,
      paymentTerms: null,
      deliveryTime: null,
      validUntil: null,
      discount: null,
      total: 100,
      billingType: 'INSTALLMENTS',
      startOffsetDays: 30,
      billingDay: null,
      durationMonths: null,
      downPaymentPercent: 30,
      downPaymentAmount: null,
      downPaymentOffsetDays: 5,
      installments: 8,
      items: [{ description: 'A', quantity: 1, unitPrice: 100, order: 0 }],
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.create.mockResolvedValue({
      id: 'p2',
      number: 'PROP-2026-0001',
      version: 2,
    } as never);
    await service.newVersion('owner', 'p1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 'PROP-2026-0001',
        version: 2,
        parentId: 'p1',
        status: 'DRAFT',
        billingType: 'INSTALLMENTS',
        startOffsetDays: 30,
        billingDay: null,
        durationMonths: null,
        downPaymentPercent: 30,
        downPaymentAmount: null,
        downPaymentOffsetDays: 5,
        installments: 8,
      }),
    );
  });

  it('registra UM aceite na trilha, com o movimento do deal como consequência', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      clientId: 'cli',
      status: 'SENT',
      number: 'PROP-2026-0042',
      dealId: 'd1',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' } as never);
    stages.wonStage.mockResolvedValue({ id: 'won', isWon: true });
    deals.board.mockResolvedValue([{ id: 'd1', stageId: 's1' }]);

    await service.accept('owner', 'p1');

    expect(audit.registrar).toHaveBeenCalledTimes(1);
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'PROPOSAL',
        action: 'ACEITAR',
        entityId: 'p1',
        entityLabel: 'PROP-2026-0042',
        extra: { dealMovidoParaGanhou: true },
      }),
    );
  });
});
