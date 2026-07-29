import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractsService } from './contracts.service';
import type { ContractRepository } from '../domain/contract.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { AuditService } from '../../audit/audit.service';
import type { ExportService } from '../../data/application/export.service';
import type { ProposalsService } from '../../proposals/application/proposals.service';

describe('ContractsService', () => {
  let repo: jest.Mocked<ContractRepository>;
  let clients: { findOne: jest.Mock };
  let audit: { registrar: jest.Mock };
  let exporter: { gerar: jest.Mock };
  let proposals: { findOne: jest.Mock; versions: jest.Mock };
  let service: ContractsService;

  const propostaBase = {
    id: 'prop-1',
    number: 'PROP-2026-0042',
    version: 1,
    status: 'ACCEPTED',
    total: 11480,
    decidedAt: new Date('2026-08-10T00:00:00.000Z'),
    clientId: 'cli',
    client: { id: 'cli', name: 'Cliente' },
    billingType: 'INSTALLMENTS',
    startOffsetDays: 30,
    billingDay: null,
    durationMonths: null,
    downPaymentPercent: 30,
    downPaymentAmount: null,
    downPaymentOffsetDays: 5,
    installments: 3,
  };

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findByClient: jest.fn(),
      findByProposalIds: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      findActiveRecurring: jest.fn(),
    };
    clients = { findOne: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    exporter = { gerar: jest.fn().mockResolvedValue('arquivo') };
    proposals = {
      findOne: jest.fn().mockResolvedValue(propostaBase),
      versions: jest.fn().mockResolvedValue([propostaBase]),
    };
    service = new ContractsService(
      repo,
      clients as unknown as ClientsService,
      audit as unknown as AuditService,
      exporter as unknown as ExportService,
      proposals as unknown as ProposalsService,
    );
  });

  it('lança UnprocessableEntityException quando o filtro excede o teto de exportação', async () => {
    repo.findManyAndCount.mockResolvedValue({ data: [], total: 5001 });
    await expect(
      service.export('owner-1', { formato: 'csv' } as never),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(exporter.gerar).not.toHaveBeenCalled();
  });

  it('lança NotFoundException ao carregar contrato inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('owner', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lança NotFoundException quando o cliente do contrato não é do dono', async () => {
    repo.findById.mockResolvedValue({ id: 'c1', clientId: 'cli' } as never);
    clients.findOne.mockRejectedValue(
      new NotFoundException('Cliente não encontrado.'),
    );
    await expect(service.findOne('owner', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cria INSTALLMENTS gerando Entrada + N parcelas com soma exata', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.create.mockResolvedValue({
      id: 'c1',
      description: 'Contrato',
      payments: [],
    } as never);
    await service.create('owner', {
      clientId: 'cli',
      description: 'Site institucional',
      billingType: 'INSTALLMENTS',
      downPayment: 1000,
      installments: 8,
      installmentAmount: 500,
      firstInstallmentDueDate: '2026-09-01',
    } as never);
    expect(clients.findOne).toHaveBeenCalledWith('owner', 'cli');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        billingType: 'INSTALLMENTS',
        status: 'ACTIVE',
        downPayment: 1000,
        installments: 8,
        installmentAmount: 500,
        payments: {
          create: expect.arrayContaining([
            expect.objectContaining({ description: 'Entrada', amount: 1000 }),
            expect.objectContaining({
              description: 'Parcela 1/8',
              amount: 500,
            }),
            expect.objectContaining({
              description: 'Parcela 8/8',
              amount: 500,
            }),
          ]),
        },
      }),
    );
    const call = repo.create.mock.calls[0][0] as {
      payments: { create: { amount: number }[] };
    };
    expect(call.payments.create).toHaveLength(9);
    const total = call.payments.create.reduce((s, c) => s + c.amount, 0);
    expect(total).toBe(5000);
  });

  it('cria ONE_TIME gerando uma única cobrança', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.create.mockResolvedValue({
      id: 'c1',
      description: 'Contrato',
      payments: [],
    } as never);
    await service.create('owner', {
      clientId: 'cli',
      description: 'Consultoria',
      billingType: 'ONE_TIME',
      amount: 3000,
      dueDate: '2026-08-15',
    } as never);
    const call = repo.create.mock.calls[0][0] as {
      payments: { create: { description: string; amount: number }[] };
    };
    expect(call.payments.create).toHaveLength(1);
    expect(call.payments.create[0]).toEqual(
      expect.objectContaining({ description: 'Pagamento único', amount: 3000 }),
    );
  });

  it('cria RECURRING sem gerar nenhuma cobrança', async () => {
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.create.mockResolvedValue({
      id: 'c1',
      description: 'Contrato',
      payments: [],
    } as never);
    await service.create('owner', {
      clientId: 'cli',
      description: 'Manutenção mensal',
      billingType: 'RECURRING',
      monthlyAmount: 800,
      billingDay: 10,
      startDate: '2026-08-01',
    } as never);
    const call = repo.create.mock.calls[0][0] as Record<string, unknown>;
    expect(call.payments).toBeUndefined();
    expect(call.monthlyAmount).toBe(800);
    expect(call.billingDay).toBe(10);
  });

  it('recusa transição inválida (resume de CANCELED)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      clientId: 'cli',
      status: 'CANCELED',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.resume('owner', 'c1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('pause/resume alteram o status', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      clientId: 'cli',
      status: 'ACTIVE',
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'c1', status: 'PAUSED' } as never);
    await service.pause('owner', 'c1');
    expect(repo.update).toHaveBeenCalledWith('c1', { status: 'PAUSED' });
  });

  it('cancelar cancela apenas cobranças PENDING/OVERDUE (as PAID ficam intactas)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      clientId: 'cli',
      status: 'ACTIVE',
      description: 'Manutenção mensal',
      payments: [],
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'c1', status: 'CANCELED' } as never);
    await service.cancel('owner', 'c1');
    expect(repo.update).toHaveBeenCalledWith('c1', {
      status: 'CANCELED',
      payments: {
        updateMany: {
          where: { status: { in: ['PENDING', 'OVERDUE'] } },
          data: { status: 'CANCELED' },
        },
      },
    });
  });

  it('registra UM cancelamento agregado, com a contagem de cobranças em aberto', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      clientId: 'cli',
      status: 'ACTIVE',
      description: 'Manutenção mensal',
      payments: [
        { id: 'p1', status: 'PENDING' },
        { id: 'p2', status: 'OVERDUE' },
        { id: 'p3', status: 'PENDING' },
        { id: 'p4', status: 'PAID' }, // não conta: já estava fora de aberto
      ],
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'c1', status: 'CANCELED' } as never);

    await service.cancel('owner', 'c1');

    expect(audit.registrar).toHaveBeenCalledTimes(1);
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'CONTRACT',
        action: 'CANCELAR',
        entityId: 'c1',
        entityLabel: 'Manutenção mensal',
        extra: { cobrancasCanceladas: 3 },
      }),
    );
  });

  describe('createFromProposal', () => {
    it('propaga o 404 do ProposalsService (proposta de outro owner)', async () => {
      proposals.findOne.mockRejectedValue(
        new NotFoundException('Proposta não encontrada.'),
      );
      await expect(
        service.createFromProposal('owner', 'prop-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('422 quando a proposta não está ACCEPTED', async () => {
      proposals.findOne.mockResolvedValue({ ...propostaBase, status: 'SENT' });
      await expect(
        service.createFromProposal('owner', 'prop-1', {}),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('422 quando a proposta não tem plano de cobrança', async () => {
      proposals.findOne.mockResolvedValue({
        ...propostaBase,
        billingType: null,
        startOffsetDays: null,
        downPaymentPercent: null,
        downPaymentOffsetDays: null,
        installments: null,
      });
      await expect(
        service.createFromProposal('owner', 'prop-1', {}),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('409 quando a cadeia de versões já tem contrato, nomeando o contrato existente', async () => {
      repo.findByProposalIds.mockResolvedValue([
        { id: 'c-existente', description: 'Contrato antigo' },
      ] as never);
      await expect(
        service.createFromProposal('owner', 'prop-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('422 quando a entrada cobre o total da proposta (parcela zero)', async () => {
      proposals.findOne.mockResolvedValue({
        ...propostaBase,
        downPaymentPercent: 100,
      });
      await expect(
        service.createFromProposal('owner', 'prop-1', {}),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('caminho feliz INSTALLMENTS: grava os campos derivados e audita UM registro', async () => {
      repo.create.mockResolvedValue({
        id: 'c1',
        description: 'Contrato — PROP-2026-0042',
        payments: [{}, {}, {}, {}],
      } as never);
      const criado = await service.createFromProposal('owner', 'prop-1', {});
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner',
          clientId: 'cli',
          proposalId: 'prop-1',
          billingType: 'INSTALLMENTS',
          installments: 3,
          downPayment: 3444,
        }),
      );
      expect(audit.registrar).toHaveBeenCalledTimes(1);
      expect(audit.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'CONTRACT',
          action: 'CRIAR',
          entityId: 'c1',
          extra: expect.objectContaining({
            derivadoDeProposta: true,
            propostaId: 'prop-1',
            propostaNumero: 'PROP-2026-0042',
          }),
        }),
      );
      expect(criado.id).toBe('c1');
    });

    it('caminho feliz RECURRING: grava monthlyAmount/billingDay/startDate/endDate, sem cobranças', async () => {
      proposals.findOne.mockResolvedValue({
        ...propostaBase,
        billingType: 'RECURRING',
        billingDay: 10,
        durationMonths: 12,
        downPaymentPercent: null,
        downPaymentOffsetDays: null,
        installments: null,
      });
      repo.create.mockResolvedValue({
        id: 'c1',
        description: 'Contrato',
        payments: [],
      } as never);
      await service.createFromProposal('owner', 'prop-1', {});
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          billingType: 'RECURRING',
          monthlyAmount: 11480,
          billingDay: 10,
          startDate: expect.any(Date),
          endDate: expect.any(Date),
          payments: { create: [] },
        }),
      );
    });

    it('caminho feliz ONE_TIME: grava uma cobrança única', async () => {
      proposals.findOne.mockResolvedValue({
        ...propostaBase,
        billingType: 'ONE_TIME',
        downPaymentPercent: null,
        downPaymentOffsetDays: null,
        installments: null,
      });
      repo.create.mockResolvedValue({
        id: 'c1',
        description: 'Contrato',
        payments: [{}],
      } as never);
      await service.createFromProposal('owner', 'prop-1', {});
      const call = repo.create.mock.calls[0][0] as {
        billingType: string;
        payments: { create: { description: string; amount: number }[] };
      };
      expect(call.billingType).toBe('ONE_TIME');
      expect(call.payments.create).toHaveLength(1);
      expect(call.payments.create[0].amount).toBe(11480);
    });

    it('P2002 na gravação vira 409 nomeando a proposta (corrida entre dois cliques)', async () => {
      repo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );
      await expect(
        service.createFromProposal('owner', 'prop-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('previewFromProposal', () => {
    it('nunca grava (não chama repo.create)', async () => {
      await service.previewFromProposal('owner', 'prop-1', {});
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('devolve derivado null quando a proposta não tem plano', async () => {
      proposals.findOne.mockResolvedValue({
        ...propostaBase,
        billingType: null,
        startOffsetDays: null,
        downPaymentPercent: null,
        downPaymentOffsetDays: null,
        installments: null,
      });
      const previa = await service.previewFromProposal('owner', 'prop-1', {});
      expect(previa.derivado).toBeNull();
      expect(previa.plano).toBeNull();
    });

    it('recusa plano incoerente vindo do body com 422 (é o erro inline da tela)', async () => {
      await expect(
        service.previewFromProposal('owner', 'prop-1', {
          plano: {
            billingType: 'RECURRING',
            startOffsetDays: 0,
            billingDay: 10,
            installments: 3, // não pertence ao regime recorrente
          },
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('não valida coerência quando a proposta não tem plano (histórico abre em branco)', async () => {
      proposals.findOne.mockResolvedValue({
        ...propostaBase,
        billingType: null,
        startOffsetDays: null,
        downPaymentPercent: null,
        downPaymentOffsetDays: null,
        installments: null,
      });
      await expect(
        service.previewFromProposal('owner', 'prop-1', {}),
      ).resolves.toMatchObject({ plano: null, derivado: null });
    });

    it('devolve contratosExistentes preenchido sem lançar', async () => {
      repo.findByProposalIds.mockResolvedValue([
        {
          id: 'c-existente',
          description: 'Contrato antigo',
          status: 'ACTIVE',
          proposalId: 'prop-1',
        },
      ] as never);
      const previa = await service.previewFromProposal('owner', 'prop-1', {});
      expect(previa.contratosExistentes).toEqual([
        {
          id: 'c-existente',
          description: 'Contrato antigo',
          status: 'ACTIVE',
          proposalId: 'prop-1',
        },
      ]);
    });
  });
});
