import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ColumnFilter } from '@/components/ui/column-filter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from '@/components/ui/calendar';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLink } from '@/components/ui/table-link';
import { SortButton, type SortDirection } from '@/components/ui/sort-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BILLING_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  translateBillingType,
  translatePaymentStatus,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePayments, usePaymentsSummary } from './api/hooks';
import { formatMoney, PAYMENT_STATUS_BADGE } from './lib/finance-format';
import { isOverdue } from './lib/overdue';
import { BaixaDialog } from './components/BaixaDialog';
import type { BillingType, Payment, PaymentSortField, PaymentStatus } from './api/types';

const LIMIT = 50;

/** Presets de status por card — clicar aplica o conjunto como filtro da listagem. */
const CARD_PRESETS = {
  recebido: ['PAID'],
  aReceber: ['PENDING', 'OVERDUE'],
  emAtraso: ['OVERDUE'],
} satisfies Record<string, PaymentStatus[]>;

/** Dois conjuntos de status são iguais (ordem irrelevante)? */
function sameStatusSet(a: PaymentStatus[], b: PaymentStatus[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** Card de total clicável que aplica/limpa um filtro de status na listagem. */
function SummaryCard({
  label,
  value,
  active,
  destructive,
  onClick,
}: {
  label: string;
  value?: number;
  active: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title="Clique para filtrar as cobranças que formam este valor"
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border p-4 text-left transition-colors hover:border-primary/60 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-lg font-semibold', destructive && 'text-destructive')}>
        {formatMoney(value)}
      </span>
    </button>
  );
}

/** Cabeçalho de coluna com filtro de opção única (mesmo padrão de `PropostasListPage`). */
function ColumnRadioFilter<T extends string>({
  label,
  name,
  value,
  onValueChange,
  options,
  translate,
  sortDirection,
  onSort,
}: {
  label: string;
  name: string;
  value: T | 'ALL';
  onValueChange: (value: T | 'ALL') => void;
  options: T[];
  translate: (value: T) => string;
  sortDirection?: SortDirection | null;
  onSort?: () => void;
}) {
  const items: Array<{ value: T | 'ALL'; label: string }> = [
    { value: 'ALL', label: 'Todos' },
    ...options.map((opt) => ({ value: opt, label: translate(opt) })),
  ];
  return (
    <ColumnFilter
      label={label}
      active={value !== 'ALL'}
      onClear={() => onValueChange('ALL')}
      contentClassName="w-52"
      sortDirection={sortDirection}
      onSort={onSort}
    >
      <div className="space-y-1">
        {items.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onValueChange(opt.value)}
              className="size-4 accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </ColumnFilter>
  );
}

export default function RecebimentosPage() {
  const [statusFilter, setStatusFilter] = useState<PaymentStatus[]>([]);
  const [billingType, setBillingType] = useState<BillingType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [dueRange, setDueRange] = useState<DateRange | undefined>();
  const [sort, setSort] = useState<{ by: PaymentSortField | null; dir: SortDirection }>({
    by: null,
    dir: 'asc',
  });
  const [baixaTarget, setBaixaTarget] = useState<Payment | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);

  /** Clica na coluna: ativa a ordenação por ela; se já ativa, inverte a direção. */
  const toggleSort = (field: PaymentSortField) =>
    setSort((prev) =>
      prev.by === field
        ? { by: field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { by: field, dir: 'asc' },
    );
  const sortDirOf = (field: PaymentSortField): SortDirection | null =>
    sort.by === field ? sort.dir : null;

  /** Filtros compartilhados entre listagem e resumo (o resumo ignora o status). */
  const sharedFilters = {
    search: debouncedSearch || undefined,
    billingType: billingType === 'ALL' ? undefined : billingType,
    dueFrom: dueRange?.from,
    dueTo: dueRange?.to,
  };

  const { data, isLoading, isError } = usePayments({
    limit: LIMIT,
    status: statusFilter.length ? statusFilter : undefined,
    sortBy: sort.by ?? undefined,
    sortDir: sort.by ? sort.dir : undefined,
    ...sharedFilters,
  });

  // Totais agregados no servidor (independentes do status filtrado na listagem).
  const { data: summary } = usePaymentsSummary(sharedFilters);

  const payments: Payment[] = data?.data ?? [];

  /** O radio de coluna representa 1 status; conjuntos maiores (ex.: A receber) exibem "Todos". */
  const columnStatus: PaymentStatus | 'ALL' =
    statusFilter.length === 1 ? statusFilter[0] : 'ALL';

  /** Aplica um preset de card como filtro; clicar no card ativo limpa o filtro. */
  const toggleCard = (preset: PaymentStatus[]) =>
    setStatusFilter((prev) => (sameStatusSet(prev, preset) ? [] : preset));

  const isCardActive = (preset: PaymentStatus[]) => sameStatusSet(statusFilter, preset);

  /** Total por cliente (visão de inadimplência), só relevante com o filtro Em atraso. */
  const porCliente =
    isCardActive(CARD_PRESETS.emAtraso)
      ? Object.values(
          payments.reduce<Record<string, { name: string; total: number }>>((acc, p) => {
            const id = p.contract?.client.id ?? '—';
            const name = p.contract?.client.name ?? '—';
            acc[id] ??= { name, total: 0 };
            acc[id].total += Number(p.amount);
            return acc;
          }, {}),
        )
      : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Recebimentos</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Buscar por cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <DateRangePicker
          className="ml-auto"
          value={dueRange}
          onChange={setDueRange}
          placeholder="Vencimento"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Recebido"
          value={summary?.recebido}
          active={isCardActive(CARD_PRESETS.recebido)}
          onClick={() => toggleCard(CARD_PRESETS.recebido)}
        />
        <SummaryCard
          label="A receber"
          value={summary?.aReceber}
          active={isCardActive(CARD_PRESETS.aReceber)}
          onClick={() => toggleCard(CARD_PRESETS.aReceber)}
        />
        <SummaryCard
          label="Em atraso"
          value={summary?.emAtraso}
          active={isCardActive(CARD_PRESETS.emAtraso)}
          destructive
          onClick={() => toggleCard(CARD_PRESETS.emAtraso)}
        />
      </div>

      {isCardActive(CARD_PRESETS.emAtraso) && porCliente.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="font-heading text-sm font-medium">Inadimplência por cliente</h2>
          <ul className="flex flex-col gap-1">
            {porCliente.map((c) => (
              <li key={c.name} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <span className="font-medium text-destructive">{formatMoney(c.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cobrança</TableHead>
              <TableHead>
                <SortButton
                  label="Contrato"
                  direction={sortDirOf('contract')}
                  onSort={() => toggleSort('contract')}
                />
              </TableHead>
              <TableHead>
                <SortButton
                  label="Cliente"
                  direction={sortDirOf('client')}
                  onSort={() => toggleSort('client')}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Regime"
                  name="billing-type-filter"
                  value={billingType}
                  onValueChange={setBillingType}
                  options={Object.keys(BILLING_TYPE_LABELS) as BillingType[]}
                  translate={translateBillingType}
                />
              </TableHead>
              <TableHead>
                <SortButton
                  label="Vencimento"
                  direction={sortDirOf('dueDate')}
                  onSort={() => toggleSort('dueDate')}
                />
              </TableHead>
              <TableHead>
                <SortButton
                  label="Valor"
                  direction={sortDirOf('amount')}
                  onSort={() => toggleSort('amount')}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={columnStatus}
                  onValueChange={(v) => setStatusFilter(v === 'ALL' ? [] : [v])}
                  options={Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]}
                  translate={translatePaymentStatus}
                  sortDirection={sortDirOf('status')}
                  onSort={() => toggleSort('status')}
                />
              </TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableEmpty colSpan={8}>Falha ao carregar recebimentos.</TableEmpty>
            ) : isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : payments.length > 0 ? (
              payments.map((payment) => {
                const overdue = payment.status === 'OVERDUE' || isOverdue(payment);
                return (
                  <TableRow key={payment.id}>
                    <TableCell>{payment.description}</TableCell>
                    <TableCell>
                      <TableLink to={`/financeiro/contratos/${payment.contractId}`}>
                        {payment.contract?.description ?? '—'}
                      </TableLink>
                    </TableCell>
                    <TableCell>
                      {payment.contract ? (
                        <TableLink to={`/clientes/${payment.contract.client.id}`}>
                          {payment.contract.client.name}
                        </TableLink>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {payment.contract ? translateBillingType(payment.contract.billingType) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={overdue ? 'text-destructive' : undefined}>
                          {formatDate(payment.dueDate) || '—'}
                        </span>
                        {overdue && <Badge variant="destructive">Vencida</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{formatMoney(payment.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={PAYMENT_STATUS_BADGE[payment.status]}>
                        {translatePaymentStatus(payment.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(payment.status === 'PENDING' || payment.status === 'OVERDUE') && (
                        <Button size="sm" variant="outline" onClick={() => setBaixaTarget(payment)}>
                          <Wallet data-icon="inline-start" />
                          Dar baixa
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableEmpty colSpan={8}>Nenhuma cobrança encontrada.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      {baixaTarget && (
        <BaixaDialog
          open
          onOpenChange={(open) => !open && setBaixaTarget(null)}
          payment={baixaTarget}
        />
      )}
    </div>
  );
}
