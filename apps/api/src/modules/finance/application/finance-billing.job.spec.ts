import { FinanceBillingJob } from './finance-billing.job';
import { billingDatesInWindow } from './schedule';
import type { ContractRepository } from '../domain/contract.repository';
import type { PaymentRepository } from '../domain/payment.repository';
import type { AuditService } from '../../audit/audit.service';

describe('FinanceBillingJob', () => {
  let contracts: jest.Mocked<ContractRepository>;
  let payments: jest.Mocked<PaymentRepository>;
  let audit: { registrarPeloSistema: jest.Mock };
  let job: FinanceBillingJob;

  beforeEach(() => {
    contracts = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      findByClient: jest.fn(),
      update: jest.fn(),
      findActiveRecurring: jest.fn(),
    };
    payments = {
      findById: jest.fn(),
      findManyAndCount: jest.fn(),
      sumByStatus: jest.fn(),
      update: jest.fn(),
      existsForDueDate: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'pay-1', description: 'X' }),
      markOverdue: jest.fn().mockResolvedValue([]),
    };
    audit = { registrarPeloSistema: jest.fn().mockResolvedValue(undefined) };
    job = new FinanceBillingJob(
      contracts,
      payments,
      audit as unknown as AuditService,
    );
  });

  it('gera a mensalidade quando ainda não existe', async () => {
    const billingDay = 10;
    contracts.findActiveRecurring.mockResolvedValue([
      {
        id: 'c1',
        billingDay,
        startDate: new Date('2000-01-01'), // já começou há muito tempo
        endDate: null,
        monthlyAmount: 800,
      } as never,
    ]);
    payments.existsForDueDate.mockResolvedValue(false);

    // Mesmo cálculo do job (janela now..now+30d), usado só para achar a
    // data esperada sem acoplar o teste a uma data fixa de calendário.
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 30);
    const [expectedDueDate] = billingDatesInWindow(
      { billingDay, startDate: new Date('2000-01-01'), endDate: null },
      now,
      horizon,
    );
    const mm = String(expectedDueDate.getMonth() + 1).padStart(2, '0');
    const yyyy = expectedDueDate.getFullYear();

    await job.run();

    expect(payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'c1',
        description: `Mensalidade ${mm}/${yyyy}`,
        amount: 800,
        status: 'PENDING',
      }),
    );
    expect(payments.markOverdue).toHaveBeenCalledWith(expect.any(Date));
  });

  it('não duplica quando existsForDueDate retorna true (idempotência)', async () => {
    contracts.findActiveRecurring.mockResolvedValue([
      {
        id: 'c1',
        billingDay: 10,
        startDate: new Date('2026-01-01'),
        endDate: null,
        monthlyAmount: 800,
      } as never,
    ]);
    payments.existsForDueDate.mockResolvedValue(true);

    await job.run();

    expect(payments.create).not.toHaveBeenCalled();
  });

  it('pula contrato fora da janela [startDate, endDate]', async () => {
    contracts.findActiveRecurring.mockResolvedValue([
      {
        id: 'c1',
        billingDay: 10,
        startDate: new Date('2027-01-01'), // ainda não começou
        endDate: null,
        monthlyAmount: 800,
      } as never,
    ]);

    await job.run();

    expect(payments.existsForDueDate).not.toHaveBeenCalled();
    expect(payments.create).not.toHaveBeenCalled();
  });

  it('chama markOverdue com a data atual', async () => {
    contracts.findActiveRecurring.mockResolvedValue([]);
    await job.run();
    expect(payments.markOverdue).toHaveBeenCalledWith(expect.any(Date));
  });

  it('registra uma linha de trilha por cobrança vencida, com o ownerId DA COBRANÇA', async () => {
    contracts.findActiveRecurring.mockResolvedValue([]);
    payments.markOverdue.mockResolvedValue([
      { id: 'p1', ownerId: 'owner-a', description: 'Mensalidade 06/2026' },
      { id: 'p2', ownerId: 'owner-b', description: 'Parcela 2/8' },
    ]);

    await job.run();

    expect(audit.registrarPeloSistema).toHaveBeenCalledTimes(2);
    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-a',
        actorType: 'CRON',
        actorName: 'Rotina diária',
        entity: 'PAYMENT',
        entityId: 'p1',
        action: 'VENCER',
      }),
    );
    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-b', entityId: 'p2' }),
    );
  });

  it('registra a mensalidade gerada com o contrato no extra', async () => {
    contracts.findActiveRecurring.mockResolvedValue([
      {
        id: 'c1',
        ownerId: 'owner-a',
        billingDay: 10,
        startDate: new Date('2000-01-01'),
        endDate: null,
        monthlyAmount: 800,
      } as never,
    ]);
    payments.existsForDueDate.mockResolvedValue(false);
    payments.create.mockResolvedValue({
      id: 'pay-9',
      description: 'Mensalidade 08/2026',
    } as never);

    await job.run();

    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-a',
        actorType: 'CRON',
        entity: 'PAYMENT',
        entityId: 'pay-9',
        action: 'CRIAR',
        extra: expect.objectContaining({ contratoId: 'c1' }),
      }),
    );
  });
});
