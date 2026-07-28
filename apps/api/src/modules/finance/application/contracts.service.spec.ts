import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import type { ContractRepository } from '../domain/contract.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { AuditService } from '../../audit/audit.service';
import type { ExportService } from '../../data/application/export.service';

describe('ContractsService', () => {
  let repo: jest.Mocked<ContractRepository>;
  let clients: { findOne: jest.Mock };
  let audit: { registrar: jest.Mock };
  let exporter: { gerar: jest.Mock };
  let service: ContractsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findByClient: jest.fn(),
      update: jest.fn(),
      findActiveRecurring: jest.fn(),
    };
    clients = { findOne: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    exporter = { gerar: jest.fn().mockResolvedValue('arquivo') };
    service = new ContractsService(
      repo,
      clients as unknown as ClientsService,
      audit as unknown as AuditService,
      exporter as unknown as ExportService,
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
});
