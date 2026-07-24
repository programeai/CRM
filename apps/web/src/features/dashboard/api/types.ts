// Enums do domínio (espelham o schema; ver @/lib/labels para tradução pt-BR).
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type ActivityType =
  | 'NOTE'
  | 'CALL'
  | 'MEETING'
  | 'EMAIL'
  | 'WHATSAPP'
  | 'FOLLOW_UP';

/** Uma coluna do funil (estágio + agregados). Valores monetários em number. */
export interface FunnelStage {
  stageId: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
  count: number;
  amount: number;
}

export interface UpcomingTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
}

export interface UpcomingAction {
  id: string;
  type: ActivityType;
  content: string;
  scheduledFor: string | null;
  clientId: string;
  clientName: string;
}

export interface UpcomingPayment {
  id: string;
  description: string;
  dueDate: string;
  amount: number;
  contractId: string;
  clientId: string;
  clientName: string;
}

/** Resposta de GET /dashboard/summary. */
export interface DashboardSummary {
  funnel: {
    stages: FunnelStage[];
    totalOpen: number;
    amountInNegotiation: number;
  };
  proposals: {
    openCount: number;
    openAmount: number;
    acceptedThisMonth: number;
    conversionRate: number; // 0..1
  };
  demands: {
    inProgress: number;
    overdue: number;
    upcoming: UpcomingTask[];
  };
  upcomingActions: UpcomingAction[];
}

/** Resposta de GET /dashboard/finance. */
export interface DashboardFinance {
  mrr: number;
  month: { expected: number; received: number };
  overdue: number;
  upcoming: UpcomingPayment[];
}
