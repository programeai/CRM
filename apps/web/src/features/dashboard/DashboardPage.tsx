import { useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TableLink } from '@/components/ui/table-link';
import { MonthPicker } from '@/components/ui/month-picker';
import { formatMoney, formatDate } from '@/lib/format';
import { translateTaskPriority, translateActivityType } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useDashboardFinance, useDashboardSummary } from './api/hooks';
import { Funnel } from './components/Funnel';
import type {
  DashboardFinance,
  DashboardSummary,
  UpcomingAction,
  UpcomingPayment,
  UpcomingTask,
} from './api/types';

const PRIORITY_BADGE: Record<UpcomingTask['priority'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  LOW: 'outline',
  MEDIUM: 'secondary',
  HIGH: 'default',
  URGENT: 'destructive',
};

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Mês corrente no formato `AAAA-MM` (default do seletor da seção financeira). */
function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** true se a data já passou (para destacar itens atrasados nas listas). */
function isPast(iso: string | null): boolean {
  return iso != null && new Date(iso).getTime() < Date.now();
}

/** Cartão com título e, opcionalmente, um link "ver todos". */
function Panel({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {to && (
          <Link
            to={to}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {linkLabel ?? 'Ver todos'}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

function KpiSkeletons({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SectionError({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      Falha ao carregar {label}. Tente novamente mais tarde.
    </div>
  );
}

// --- Comercial ---------------------------------------------------------------

function ComercialSection({ q }: { q: UseQueryResult<DashboardSummary> }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">Comercial</h2>
      {q.isLoading ? (
        <KpiSkeletons count={4} />
      ) : q.isError || !q.data ? (
        <SectionError label="o resumo comercial" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Em negociação"
              value={formatMoney(q.data.funnel.amountInNegotiation)}
              hint={`${q.data.funnel.totalOpen} oportunidade(s) em aberto`}
            />
            <StatCard
              label="Propostas em aberto"
              value={q.data.proposals.openCount}
              hint={formatMoney(q.data.proposals.openAmount)}
            />
            <StatCard
              label="Aceitas no mês"
              value={q.data.proposals.acceptedThisMonth}
              tone="positive"
            />
            <StatCard
              label="Conversão (90 dias)"
              value={formatPercent(q.data.proposals.conversionRate)}
              hint="Aceitas ÷ decididas"
            />
          </div>
          <Panel title="Funil de oportunidades" to="/pipeline" linkLabel="Abrir pipeline">
            <Funnel stages={q.data.funnel.stages} />
          </Panel>
        </>
      )}
    </section>
  );
}

// --- Financeiro --------------------------------------------------------------

function PaymentRow({ payment }: { payment: UpcomingPayment }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="flex min-w-0 flex-col">
        <TableLink to={`/financeiro/contratos/${payment.contractId}`}>
          {payment.description}
        </TableLink>
        <span className="truncate text-xs text-muted-foreground">{payment.clientName}</span>
      </div>
      <div className="flex flex-col items-end whitespace-nowrap">
        <span className="font-medium">{formatMoney(payment.amount)}</span>
        <span className="text-xs text-muted-foreground">{formatDate(payment.dueDate)}</span>
      </div>
    </li>
  );
}

function FinanceiroSection({
  q,
  month,
  onMonthChange,
}: {
  q: UseQueryResult<DashboardFinance>;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">Financeiro</h2>
        <MonthPicker value={month} onChange={onMonthChange} />
      </div>
      {q.isLoading ? (
        <KpiSkeletons count={4} />
      ) : q.isError || !q.data ? (
        <SectionError label="o resumo financeiro" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="MRR" value={formatMoney(q.data.mrr)} hint="Mensalidades ativas" />
            <StatCard label="Previsto no mês" value={formatMoney(q.data.month.expected)} />
            <StatCard
              label="Recebido no mês"
              value={formatMoney(q.data.month.received)}
              tone="positive"
              hint={`${formatPercent(
                q.data.month.expected > 0 ? q.data.month.received / q.data.month.expected : 0,
              )} do previsto`}
            />
            <StatCard label="Em atraso" value={formatMoney(q.data.overdue)} tone="danger" />
          </div>
          <Panel
            title="Próximos vencimentos (7 dias)"
            to="/financeiro"
            linkLabel="Abrir recebimentos"
          >
            {q.data.upcoming.length === 0 ? (
              <EmptyRow>Nenhuma cobrança a vencer nos próximos 7 dias.</EmptyRow>
            ) : (
              <ul className="divide-y">
                {q.data.upcoming.map((p) => (
                  <PaymentRow key={p.id} payment={p} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </section>
  );
}

// --- Operação (demandas + próximas ações) -----------------------------------

function TaskRow({ task }: { task: UpcomingTask }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="flex min-w-0 flex-col">
        <TableLink to={`/projetos/${task.projectId}`}>{task.title}</TableLink>
        <span className="truncate text-xs text-muted-foreground">
          {task.projectName} · {task.clientName}
        </span>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <Badge variant={PRIORITY_BADGE[task.priority]}>
          {translateTaskPriority(task.priority)}
        </Badge>
        <span className={cn('text-xs', isPast(task.dueDate) ? 'text-destructive' : 'text-muted-foreground')}>
          {formatDate(task.dueDate)}
        </span>
      </div>
    </li>
  );
}

function ActionRow({ action }: { action: UpcomingAction }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="flex min-w-0 flex-col">
        <TableLink to={`/clientes/${action.clientId}`}>{action.clientName}</TableLink>
        <span className="truncate text-xs text-muted-foreground">
          {translateActivityType(action.type)} · {action.content}
        </span>
      </div>
      <span
        className={cn(
          'whitespace-nowrap text-xs',
          isPast(action.scheduledFor) ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {formatDate(action.scheduledFor)}
      </span>
    </li>
  );
}

function OperacaoSection({ q }: { q: UseQueryResult<DashboardSummary> }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">Operação</h2>
      {q.isLoading ? (
        <KpiSkeletons count={2} />
      ) : q.isError || !q.data ? (
        <SectionError label="as demandas" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard label="Demandas em andamento" value={q.data.demands.inProgress} />
            <StatCard
              label="Demandas atrasadas"
              value={q.data.demands.overdue}
              tone={q.data.demands.overdue > 0 ? 'danger' : 'default'}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Próximas entregas (7 dias)" to="/demandas" linkLabel="Minhas demandas">
              {q.data.demands.upcoming.length === 0 ? (
                <EmptyRow>Nenhuma entrega nos próximos 7 dias.</EmptyRow>
              ) : (
                <ul className="divide-y">
                  {q.data.demands.upcoming.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Próximas ações">
              {q.data.upcomingActions.length === 0 ? (
                <EmptyRow>Nenhum follow-up agendado.</EmptyRow>
              ) : (
                <ul className="divide-y">
                  {q.data.upcomingActions.map((a) => (
                    <ActionRow key={a.id} action={a} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonthValue);

  const summary = useDashboardSummary();
  const finance = useDashboardFinance(month);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
      <ComercialSection q={summary} />
      <FinanceiroSection q={finance} month={month} onMonthChange={setMonth} />
      <OperacaoSection q={summary} />
    </div>
  );
}
