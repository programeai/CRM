import { DashboardService, buildWindows, monthBounds } from './dashboard.service';
import type { DashboardRepository } from '../domain/dashboard.repository';

describe('monthBounds', () => {
  const now = new Date('2026-07-23T15:00:00.000Z');

  it('usa o mês de `now` quando `month` é ausente', () => {
    const { monthStart, monthEnd } = monthBounds(now);
    expect(monthStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(monthEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('recorta o mês informado (AAAA-MM) em UTC, fim exclusivo', () => {
    const { monthStart, monthEnd } = monthBounds(now, '2026-02');
    expect(monthStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(monthEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('vira o ano em dezembro', () => {
    const { monthEnd } = monthBounds(now, '2026-12');
    expect(monthEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('buildWindows', () => {
  it('recorta o mês em UTC (início inclusivo, fim exclusivo)', () => {
    const w = buildWindows(new Date('2026-07-23T15:00:00.000Z'));
    expect(w.monthStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(w.monthEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('vira o ano ao calcular o mês seguinte em dezembro', () => {
    const w = buildWindows(new Date('2026-12-10T00:00:00.000Z'));
    expect(w.monthEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('projeta 7 dias à frente e 90 dias atrás', () => {
    const now = new Date('2026-07-23T00:00:00.000Z');
    const w = buildWindows(now);
    expect(w.upcomingUntil.toISOString()).toBe('2026-07-30T00:00:00.000Z');
    expect(w.conversionSince.toISOString()).toBe('2026-04-24T00:00:00.000Z');
  });
});

describe('DashboardService', () => {
  let repo: jest.Mocked<DashboardRepository>;
  let service: DashboardService;

  beforeEach(() => {
    repo = {
      funnel: jest.fn(),
      proposalsOpen: jest.fn(),
      proposalsAcceptedCount: jest.fn(),
      proposalsDecidedSince: jest.fn(),
      tasksInProgressCount: jest.fn(),
      tasksOverdueCount: jest.fn(),
      upcomingTasks: jest.fn(),
      upcomingActions: jest.fn(),
      monthlyRecurringRevenue: jest.fn(),
      monthSchedule: jest.fn(),
      overdueTotal: jest.fn(),
      upcomingPayments: jest.fn(),
    };
    service = new DashboardService(repo);
  });

  it('agrega só os estágios abertos (ignora ganho/perdido) no funil', async () => {
    repo.funnel.mockResolvedValue([
      { stageId: 's1', name: 'Novo', isWon: false, isLost: false, count: 2, amount: 1000 },
      { stageId: 's2', name: 'Proposta', isWon: false, isLost: false, count: 1, amount: 500 },
      { stageId: 's3', name: 'Ganhou', isWon: true, isLost: false, count: 5, amount: 9999 },
      { stageId: 's4', name: 'Perdeu', isWon: false, isLost: true, count: 3, amount: 7777 },
    ]);
    repo.proposalsOpen.mockResolvedValue({ count: 0, amount: 0 });
    repo.proposalsAcceptedCount.mockResolvedValue(0);
    repo.proposalsDecidedSince.mockResolvedValue([]);
    repo.tasksInProgressCount.mockResolvedValue(0);
    repo.tasksOverdueCount.mockResolvedValue(0);
    repo.upcomingTasks.mockResolvedValue([]);
    repo.upcomingActions.mockResolvedValue([]);

    const result = await service.summary('owner');
    expect(result.funnel.totalOpen).toBe(3); // 2 + 1
    expect(result.funnel.amountInNegotiation).toBe(1500); // 1000 + 500
  });

  it('calcula a conversão como aceitas ÷ (aceitas + recusadas)', async () => {
    repo.funnel.mockResolvedValue([]);
    repo.proposalsOpen.mockResolvedValue({ count: 0, amount: 0 });
    repo.proposalsAcceptedCount.mockResolvedValue(3);
    repo.proposalsDecidedSince.mockResolvedValue([
      { status: 'ACCEPTED', count: 3 },
      { status: 'REJECTED', count: 1 },
      { status: 'EXPIRED', count: 9 }, // não entra no denominador
    ]);
    repo.tasksInProgressCount.mockResolvedValue(0);
    repo.tasksOverdueCount.mockResolvedValue(0);
    repo.upcomingTasks.mockResolvedValue([]);
    repo.upcomingActions.mockResolvedValue([]);

    const result = await service.summary('owner');
    expect(result.proposals.conversionRate).toBe(0.75); // 3 / (3 + 1)
    expect(result.proposals.acceptedThisMonth).toBe(3);
  });

  it('conversão é 0 quando não há propostas decididas', async () => {
    repo.funnel.mockResolvedValue([]);
    repo.proposalsOpen.mockResolvedValue({ count: 0, amount: 0 });
    repo.proposalsAcceptedCount.mockResolvedValue(0);
    repo.proposalsDecidedSince.mockResolvedValue([]);
    repo.tasksInProgressCount.mockResolvedValue(0);
    repo.tasksOverdueCount.mockResolvedValue(0);
    repo.upcomingTasks.mockResolvedValue([]);
    repo.upcomingActions.mockResolvedValue([]);

    const result = await service.summary('owner');
    expect(result.proposals.conversionRate).toBe(0);
  });

  it('repassa os agregados financeiros do repositório', async () => {
    repo.monthlyRecurringRevenue.mockResolvedValue(3200);
    repo.monthSchedule.mockResolvedValue({ expected: 5000, received: 2000 });
    repo.overdueTotal.mockResolvedValue(800);
    repo.upcomingPayments.mockResolvedValue([]);

    const result = await service.finance('owner');
    expect(result).toEqual({
      mrr: 3200,
      month: { expected: 5000, received: 2000 },
      overdue: 800,
      upcoming: [],
    });
  });

  it('desloca a janela do mês ao receber `month`, sem afetar o resto', async () => {
    repo.monthlyRecurringRevenue.mockResolvedValue(0);
    repo.monthSchedule.mockResolvedValue({ expected: 0, received: 0 });
    repo.overdueTotal.mockResolvedValue(0);
    repo.upcomingPayments.mockResolvedValue([]);

    await service.finance('owner', '2026-02');

    const [, monthStart, monthEnd] = repo.monthSchedule.mock.calls[0];
    expect(monthStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(monthEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // atraso e próximos vencimentos continuam relativos a agora (não ao mês).
    expect(repo.overdueTotal).toHaveBeenCalledTimes(1);
    expect(repo.upcomingPayments).toHaveBeenCalledTimes(1);
  });
});
