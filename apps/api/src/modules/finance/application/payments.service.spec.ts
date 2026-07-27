import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { PaymentRepository } from '../domain/payment.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { AuditService } from '../../audit/audit.service';

describe('PaymentsService', () => {
  let repo: jest.Mocked<PaymentRepository>;
  let clients: { findOne: jest.Mock };
  let audit: { registrar: jest.Mock };
  let service: PaymentsService;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      sumByStatus: jest.fn(),
      update: jest.fn(),
      existsForDueDate: jest.fn(),
      create: jest.fn(),
      markOverdue: jest.fn(),
    };
    clients = { findOne: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    service = new PaymentsService(
      repo,
      clients as unknown as ClientsService,
      audit as unknown as AuditService,
    );
  });

  it('lança NotFoundException para cobrança inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.pay('owner', 'nope', { method: 'PIX' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança NotFoundException quando o cliente da cobrança não é do dono', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PENDING',
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockRejectedValue(
      new NotFoundException('Cliente não encontrado.'),
    );
    await expect(
      service.pay('owner', 'p1', { method: 'PIX' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bloqueia editar cobrança fora de PENDING (422)', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PAID',
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(
      service.update('owner', 'p1', { amount: 100 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('pay seta status/paidAt/paidAmount/method', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PENDING',
      amount: 500,
      notes: null,
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'PAID' } as never);
    await service.pay('owner', 'p1', { method: 'PIX', paidAmount: 400 });
    expect(repo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        status: 'PAID',
        paidAmount: 400,
        method: 'PIX',
        paidAt: expect.any(Date),
      }),
    );
  });

  it('pay usa o valor original quando paidAmount não é informado', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'OVERDUE',
      amount: 500,
      notes: null,
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'PAID' } as never);
    await service.pay('owner', 'p1', { method: 'BOLETO' });
    expect(repo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ paidAmount: 500 }),
    );
  });

  it('revert é não-destrutivo: volta a PENDING e faz append em notes (nunca delete)', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PAID',
      notes: 'Observação anterior',
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'PENDING' } as never);
    await service.revert('owner', 'p1');
    expect(repo.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        status: 'PENDING',
        paidAt: null,
        paidAmount: null,
        method: null,
        notes: expect.stringContaining('Observação anterior'),
      }),
    );
    expect((repo.update.mock.calls[0][1] as { notes: string }).notes).toContain(
      'Estorno em',
    );
  });

  it('cancelar uma cobrança PAID é transição inválida (422)', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PAID',
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    await expect(service.cancel('owner', 'p1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('summary: aReceber = pendentes + em atraso; recebido usa paidAmount', async () => {
    repo.sumByStatus.mockResolvedValue([
      { status: 'PAID', amount: 1000, paidAmount: 950 },
      { status: 'PENDING', amount: 300, paidAmount: 0 },
      { status: 'OVERDUE', amount: 200, paidAmount: 0 },
    ]);
    const totals = await service.summary('owner', {});
    expect(totals).toEqual({ recebido: 950, aReceber: 500, emAtraso: 200 });
  });

  it('registra a baixa na trilha de auditoria', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PENDING',
      amount: 500,
      description: 'Mensalidade 07/2026',
      notes: null,
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'PAID' } as never);

    await service.pay('owner', 'p1', { method: 'PIX' });

    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'PAYMENT',
        action: 'PAGAR',
        entityId: 'p1',
        entityLabel: 'Mensalidade 07/2026',
      }),
    );
  });

  it('cancela cobrança PENDING', async () => {
    repo.findById.mockResolvedValue({
      id: 'p1',
      status: 'PENDING',
      contract: { clientId: 'cli' },
    } as never);
    clients.findOne.mockResolvedValue({ id: 'cli' });
    repo.update.mockResolvedValue({ id: 'p1', status: 'CANCELED' } as never);
    await service.cancel('owner', 'p1');
    expect(repo.update).toHaveBeenCalledWith('p1', { status: 'CANCELED' });
  });
});
