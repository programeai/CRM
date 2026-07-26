import { Inject, Injectable } from '@nestjs/common';
import {
  DASHBOARD_REPOSITORY,
  type DashboardRepository,
} from '../domain/dashboard.repository';

const UPCOMING_TAKE = 5; // itens exibidos nas listas de "próximos"
const UPCOMING_DAYS = 7; // janela de "próximas entregas/vencimentos"
const CONVERSION_DAYS = 90; // janela da taxa de conversão de propostas

/**
 * Recortes de tempo do dashboard. Usa UTC deliberadamente: datas nascidas de
 * DTOs `AAAA-MM-DD` chegam como meia-noite UTC (mesma convenção do módulo
 * `finance`), então comparar em UTC evita deslocar o dia em fusos negativos.
 */
export interface DashboardWindows {
  now: Date;
  monthStart: Date; // 1º dia do mês (00:00 UTC)
  monthEnd: Date; // 1º dia do mês seguinte (exclusivo)
  upcomingUntil: Date; // now + 7 dias
  conversionSince: Date; // now − 90 dias
}

/**
 * Início e fim (exclusivo) de um mês, em UTC. `month` no formato `AAAA-MM`;
 * ausente → mês de `now`. A validação do formato acontece no DTO da fronteira.
 */
export function monthBounds(
  now: Date,
  month?: string,
): { monthStart: Date; monthEnd: Date } {
  let year = now.getUTCFullYear();
  let monthIndex = now.getUTCMonth();
  if (month) {
    const [y, m] = month.split('-').map(Number);
    year = y;
    monthIndex = m - 1;
  }
  return {
    monthStart: new Date(Date.UTC(year, monthIndex, 1)),
    monthEnd: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

export function buildWindows(now: Date): DashboardWindows {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const upcomingUntil = new Date(now);
  upcomingUntil.setUTCDate(upcomingUntil.getUTCDate() + UPCOMING_DAYS);
  const conversionSince = new Date(now);
  conversionSince.setUTCDate(conversionSince.getUTCDate() - CONVERSION_DAYS);
  return { now, monthStart, monthEnd, upcomingUntil, conversionSince };
}

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DASHBOARD_REPOSITORY)
    private readonly repo: DashboardRepository,
  ) {}

  /**
   * Resumo comercial: funil, propostas, demandas e próximas ações.
   *
   * O dashboard é a home de **todo** colaborador (não exige permissão), mas cada
   * bloco é agregado de um módulo diferente. Por isso recebe as permissões da
   * sessão e devolve `null` no bloco que o usuário não pode ver — sem isso, quem
   * não tem `proposta:ver` leria os totais de propostas por aqui.
   */
  async summary(ownerId: string, permissions: readonly string[]) {
    const may = (...keys: string[]) =>
      keys.some((k) => permissions.includes(k));
    const mayDeals = may('oportunidade:ver', 'oportunidade:gerenciar');
    const mayProposals = may('proposta:ver', 'proposta:gerenciar');
    const mayTasks = may(
      'projeto:ver',
      'projeto:gerenciar',
      'demanda:gerenciar',
    );
    const mayClients = may('cliente:ver', 'cliente:gerenciar');

    const w = buildWindows(new Date());
    const [funnel, proposals, demands, upcomingActions] = await Promise.all([
      mayDeals ? this.funnelBlock(ownerId) : null,
      mayProposals ? this.proposalsBlock(ownerId, w) : null,
      mayTasks ? this.demandsBlock(ownerId, w) : null,
      // Próximas ações são follow-ups de clientes (ver Activity).
      mayClients ? this.repo.upcomingActions(ownerId, UPCOMING_TAKE) : [],
    ]);

    return { funnel, proposals, demands, upcomingActions };
  }

  /** Funil de oportunidades + totais em aberto. */
  private async funnelBlock(ownerId: string) {
    const stages = await this.repo.funnel(ownerId);
    // Estágios "abertos" = nem ganho nem perdido (oportunidades em negociação).
    const openStages = stages.filter((s) => !s.isWon && !s.isLost);
    return {
      stages,
      totalOpen: openStages.reduce((acc, s) => acc + s.count, 0),
      amountInNegotiation: openStages.reduce((acc, s) => acc + s.amount, 0),
    };
  }

  private async proposalsBlock(ownerId: string, w: DashboardWindows) {
    const [open, acceptedThisMonth, decided] = await Promise.all([
      this.repo.proposalsOpen(ownerId),
      this.repo.proposalsAcceptedCount(ownerId, w.monthStart, w.monthEnd),
      this.repo.proposalsDecidedSince(ownerId, w.conversionSince),
    ]);
    // Conversão nos últimos 90 dias: aceitas ÷ (aceitas + recusadas) decididas.
    const accepted = decided.find((d) => d.status === 'ACCEPTED')?.count ?? 0;
    const rejected = decided.find((d) => d.status === 'REJECTED')?.count ?? 0;
    const decidedTotal = accepted + rejected;
    return {
      openCount: open.count,
      openAmount: open.amount,
      acceptedThisMonth,
      conversionRate: decidedTotal > 0 ? accepted / decidedTotal : 0, // 0..1
    };
  }

  private async demandsBlock(ownerId: string, w: DashboardWindows) {
    const [inProgress, overdue, upcoming] = await Promise.all([
      this.repo.tasksInProgressCount(ownerId),
      this.repo.tasksOverdueCount(ownerId, w.now),
      this.repo.upcomingTasks(ownerId, w.now, w.upcomingUntil, UPCOMING_TAKE),
    ]);
    return { inProgress, overdue, upcoming };
  }

  /**
   * Resumo financeiro: MRR, previsto × recebido no mês, atraso e próximos
   * vencimentos. `month` (`AAAA-MM`) desloca apenas os totais do mês; MRR,
   * atraso e próximos vencimentos são sempre relativos a agora.
   */
  async finance(ownerId: string, month?: string) {
    const w = buildWindows(new Date());
    const { monthStart, monthEnd } = monthBounds(w.now, month);
    const [mrr, monthSchedule, overdue, upcoming] = await Promise.all([
      this.repo.monthlyRecurringRevenue(ownerId),
      this.repo.monthSchedule(ownerId, monthStart, monthEnd),
      this.repo.overdueTotal(ownerId, w.now),
      this.repo.upcomingPayments(
        ownerId,
        w.now,
        w.upcomingUntil,
        UPCOMING_TAKE,
      ),
    ]);
    return { mrr, month: monthSchedule, overdue, upcoming };
  }
}
