import type {
  ProposalStatus,
  TaskStatus,
  TaskPriority,
  ActivityType,
} from '@prisma/client';

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY');

/** Uma coluna do funil: estágio do pipeline + agregados dos deals nele. */
export interface FunnelStageRow {
  stageId: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
  count: number; // qtd de oportunidades no estágio
  amount: number; // Σ amount das oportunidades no estágio
}

/** Contagem de propostas por status (para a taxa de conversão). */
export interface ProposalStatusCount {
  status: ProposalStatus;
  count: number;
}

/** Tarefa com prazo próximo (para "próximas entregas"). */
export interface UpcomingTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
}

/** Follow-up agendado (para "próximas ações"). */
export interface UpcomingActionRow {
  id: string;
  type: ActivityType;
  content: string;
  scheduledFor: Date | null;
  clientId: string;
  clientName: string;
}

/** Cobrança a vencer (para "próximos vencimentos"). */
export interface UpcomingPaymentRow {
  id: string;
  description: string;
  dueDate: Date;
  amount: number;
  contractId: string;
  clientId: string;
  clientName: string;
}

/**
 * Consultas de leitura/agregação do dashboard. Toda posse é aplicada pela
 * relação `client.ownerId` (Deal/Proposal/Contract → client; Task → project.client;
 * Payment → contract.client). Valores `Decimal` são convertidos para `number`
 * na borda do repositório (a soma acontece no banco, sem float).
 */
export interface DashboardRepository {
  // --- Comercial ---
  /** Funil: cada estágio (na ordem) com contagem e valor das oportunidades. */
  funnel(ownerId: string): Promise<FunnelStageRow[]>;
  /** Propostas em aberto (DRAFT | SENT | NEGOTIATING): quantidade e valor. */
  proposalsOpen(ownerId: string): Promise<{ count: number; amount: number }>;
  /** Propostas ACEITAS com `decidedAt` no intervalo `[from, to)`. */
  proposalsAcceptedCount(
    ownerId: string,
    from: Date,
    to: Date,
  ): Promise<number>;
  /** Propostas decididas (por status) com `decidedAt >= since` — base da conversão. */
  proposalsDecidedSince(
    ownerId: string,
    since: Date,
  ): Promise<ProposalStatusCount[]>;

  // --- Demandas ---
  /** Tarefas em andamento (`IN_PROGRESS`). */
  tasksInProgressCount(ownerId: string): Promise<number>;
  /** Tarefas atrasadas (não concluídas com `dueDate < now`). */
  tasksOverdueCount(ownerId: string, now: Date): Promise<number>;
  /** Tarefas não concluídas com entrega em `[now, until]`, ordenadas por prazo. */
  upcomingTasks(
    ownerId: string,
    now: Date,
    until: Date,
    take: number,
  ): Promise<UpcomingTaskRow[]>;

  // --- Próximas ações ---
  /** Follow-ups agendados e não concluídos, ordenados por `scheduledFor`. */
  upcomingActions(ownerId: string, take: number): Promise<UpcomingActionRow[]>;

  // --- Financeiro ---
  /** MRR: Σ das mensalidades de contratos ATIVOS recorrentes. */
  monthlyRecurringRevenue(ownerId: string): Promise<number>;
  /**
   * Previsto × recebido no mês (por vencimento em `[monthStart, monthEnd)`):
   * `expected` = Σ das cobranças não canceladas; `received` = Σ do valor pago
   * (`paidAmount`, ou `amount` quando ausente) das cobranças PAGAS.
   */
  monthSchedule(
    ownerId: string,
    monthStart: Date,
    monthEnd: Date,
  ): Promise<{ expected: number; received: number }>;
  /** Total em atraso: OVERDUE + PENDING com `dueDate < now` (SPEC §5). */
  overdueTotal(ownerId: string, now: Date): Promise<number>;
  /** Cobranças PENDING a vencer em `[now, until]`, ordenadas por vencimento. */
  upcomingPayments(
    ownerId: string,
    now: Date,
    until: Date,
    take: number,
  ): Promise<UpcomingPaymentRow[]>;
}
