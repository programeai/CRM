import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ColumnFilter } from '@/components/ui/column-filter';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  BILLING_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  translateBillingType,
  translatePaymentStatus,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClientOptions, usePayments } from './api/hooks';
import { formatMoney, PAYMENT_STATUS_BADGE } from './lib/finance-format';
import { isOverdue } from './lib/overdue';
import { BaixaDialog } from './components/BaixaDialog';
import type { BillingType, Payment, PaymentStatus } from './api/types';

const LIMIT = 50;

/** Cabeçalho de coluna com filtro de opção única (mesmo padrão de `PropostasListPage`). */
function ColumnRadioFilter<T extends string>({
  label,
  name,
  value,
  onValueChange,
  options,
  translate,
}: {
  label: string;
  name: string;
  value: T | 'ALL';
  onValueChange: (value: T | 'ALL') => void;
  options: T[];
  translate: (value: T) => string;
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

/** Converte "AAAA-MM" (input month) em { dueFrom, dueTo } cobrindo o mês inteiro. */
function monthToRange(month: string): { dueFrom?: string; dueTo?: string } {
  if (!month) return {};
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { dueFrom: iso(first), dueTo: iso(last) };
}

export default function RecebimentosPage() {
  const [status, setStatus] = useState<PaymentStatus | 'ALL'>('ALL');
  const [billingType, setBillingType] = useState<BillingType | 'ALL'>('ALL');
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | undefined>();
  const [month, setMonth] = useState('');
  const [baixaTarget, setBaixaTarget] = useState<Payment | null>(null);

  const debouncedClientSearch = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debouncedClientSearch);

  const { dueFrom, dueTo } = monthToRange(month);
  const { data, isLoading, isError } = usePayments({
    limit: LIMIT,
    status: status === 'ALL' ? undefined : status,
    billingType: billingType === 'ALL' ? undefined : billingType,
    clientId,
    dueFrom,
    dueTo,
  });

  const payments: Payment[] = data?.data ?? [];

  const recebido = payments
    .filter((p) => p.status === 'PAID')
    .reduce((sum, p) => sum + Number(p.paidAmount ?? p.amount), 0);
  const aReceber = payments
    .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const emAtraso = payments
    .filter((p) => p.status === 'OVERDUE')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  /** Total por cliente (visão de inadimplência), só relevante com o filtro Vencido. */
  const porCliente =
    status === 'OVERDUE'
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
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={clientId ?? ''}
          onChange={(e) => setClientId(e.target.value || undefined)}
        >
          <option value="">Todos os clientes</option>
          {(clientOptions ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Buscar cliente…"
          className="h-10 w-48 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
        />
        <input
          type="month"
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">Recebido</span>
          <span className="text-lg font-semibold">{formatMoney(recebido)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">A receber</span>
          <span className="text-lg font-semibold">{formatMoney(aReceber)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">Em atraso</span>
          <span className="text-lg font-semibold text-destructive">{formatMoney(emAtraso)}</span>
        </div>
      </div>

      {status === 'OVERDUE' && porCliente.length > 0 && (
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
              <TableHead>Contrato</TableHead>
              <TableHead>Cliente</TableHead>
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
              <TableHead>Vencimento</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={setStatus}
                  options={Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[]}
                  translate={translatePaymentStatus}
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
