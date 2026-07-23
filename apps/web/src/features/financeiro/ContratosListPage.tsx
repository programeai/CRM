import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColumnFilter } from '@/components/ui/column-filter';
import { Badge } from '@/components/ui/badge';
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
  CONTRACT_STATUS_LABELS,
  translateBillingType,
  translateContractStatus,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useContracts } from './api/hooks';
import { CONTRACT_STATUS_BADGE } from './lib/finance-format';
import { ContratoFormDialog } from './ContratoFormDialog';
import type { BillingType, ContractStatus } from './api/types';

const LIMIT = 20;

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

export default function ContratosListPage() {
  const [status, setStatus] = useState<ContractStatus | 'ALL'>('ALL');
  const [billingType, setBillingType] = useState<BillingType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading, isError } = useContracts({
    page,
    limit: LIMIT,
    status: status === 'ALL' ? undefined : status,
    billingType: billingType === 'ALL' ? undefined : billingType,
  });

  const total = data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const resetToFirstPage = () => setPage(1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Contratos</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Novo contrato
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Regime"
                  name="billing-type-filter"
                  value={billingType}
                  onValueChange={(v) => {
                    setBillingType(v);
                    resetToFirstPage();
                  }}
                  options={Object.keys(BILLING_TYPE_LABELS) as BillingType[]}
                  translate={translateBillingType}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={(v) => {
                    setStatus(v);
                    resetToFirstPage();
                  }}
                  options={Object.keys(CONTRACT_STATUS_LABELS) as ContractStatus[]}
                  translate={translateContractStatus}
                />
              </TableHead>
              <TableHead>Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableEmpty colSpan={5}>Falha ao carregar contratos.</TableEmpty>
            ) : isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data && data.data.length > 0 ? (
              data.data.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell>
                    <TableLink to={`/financeiro/contratos/${contract.id}`}>
                      {contract.description}
                    </TableLink>
                  </TableCell>
                  <TableCell>{contract.client.name}</TableCell>
                  <TableCell>{translateBillingType(contract.billingType)}</TableCell>
                  <TableCell>
                    <Badge variant={CONTRACT_STATUS_BADGE[contract.status]}>
                      {translateContractStatus(contract.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(contract.createdAt)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={5}>Nenhum contrato encontrado.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} {total === 1 ? 'contrato' : 'contratos'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span>
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Próxima
          </Button>
        </div>
      </div>

      <ContratoFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
