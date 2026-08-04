import { FinanceBillingJob } from './finance-billing.job';
import { billingDatesInWindow } from './schedule';
import type { ContractRepository } from '../domain/contract.repository';
import type { PaymentRepository } from '../domain/payment.repository';
import type { AuditService } from '../../audit/audit.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import { webhooksEmitterFake } from '../../webhooks/application/webhooks-emitter.mock';

describe('FinanceBillingJob', () => {
  let contracts: jest.Mocked<ContractRepository>;
  let payments: jest.Mocked<PaymentRepository>;
  let audit: { registrarPeloSistema: jest.Mock };
  let notifications: { notificarPeloSistema: jest.Mock };
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
    notifications = {
      notificarPeloSistema: jest.fn().mockResolvedValue(undefined),
    };
    job = new FinanceBillingJob(
      contracts,
      payments,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      webhooksEmitterFake(),
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
      {
        id: 'p1',
        ownerId: 'owner-a',
        description: 'Mensalidade 06/2026',
        dueDate: new Date('2026-06-10'),
        amount: 800,
        clienteNome: 'Acme',
        assigneeId: 'u2',
      },
      {
        id: 'p2',
        ownerId: 'owner-b',
        description: 'Parcela 2/8',
        dueDate: new Date('2026-06-15'),
        amount: 500,
        clienteNome: 'Beta',
        assigneeId: null,
      },
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

  it('notifica uma vez por cobrança vencida, com o userId derivado do cliente', async () => {
    contracts.findActiveRecurring.mockResolvedValue([]);
    payments.markOverdue.mockResolvedValue([
      {
        id: 'p1',
        ownerId: 'owner-a',
        description: 'Mensalidade 06/2026',
        dueDate: new Date('2026-06-10'),
        amount: 800,
        clienteNome: 'Acme',
        assigneeId: 'u2',
      },
    ]);

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledTimes(1);
    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-a',
        userId: 'u2',
        dedupeKey: 'PAYMENT_OVERDUE:p1',
        evento: expect.objectContaining({
          tipo: 'PAYMENT_OVERDUE',
          entityId: 'p1',
          clienteNome: 'Acme',
          valor: 800,
        }),
      }),
    );
  });

  it('cai no owner quando o cliente da cobrança não tem responsável', async () => {
    contracts.findActiveRecurring.mockResolvedValue([]);
    payments.markOverdue.mockResolvedValue([
      {
        id: 'p2',
        ownerId: 'owner-b',
        description: 'Parcela 2/8',
        dueDate: new Date('2026-06-15'),
        amount: 500,
        clienteNome: 'Beta',
        assigneeId: null,
      },
    ]);

    await job.run();

    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-b', userId: 'owner-b' }),
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
