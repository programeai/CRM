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
import { Pagination } from '@/components/ui/pagination';
import {
  BILLING_TYPE_LABELS,
  CONTRACT_STATUS_LABELS,
  translateBillingType,
  translateContractStatus,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { enumFilter, numberFilter, useUrlFilters } from '@/hooks/use-url-filters';
import { useContracts } from './api/hooks';
import { CONTRACT_STATUS_BADGE } from './lib/finance-format';
import { ContratoFormDialog } from './ContratoFormDialog';
import type { BillingType, ContractStatus } from './api/types';

const LIMIT = 20;

/** Filtros da listagem persistidos na URL (sobrevivem à ida/volta de uma tela de detalhe). */
const CONTRATOS_FILTERS = {
  status: enumFilter(Object.keys(CONTRACT_STATUS_LABELS) as ContractStatus[], 'ALL' as const),
  billingType: enumFilter(Object.keys(BILLING_TYPE_LABELS) as BillingType[], 'ALL' as const),
  page: numberFilter(1),
};

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
  const { values, set } = useUrlFilters(CONTRATOS_FILTERS);
  const { status, billingType, page } = values;
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading, isError } = useContracts({
    page,
    limit: LIMIT,
    status: status === 'ALL' ? undefined : status,
    billingType: billingType === 'ALL' ? undefined : billingType,
  });

  const total = data?.meta.total ?? 0;

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
                  onValueChange={(v) => set({ billingType: v, page: 1 })}
                  options={Object.keys(BILLING_TYPE_LABELS) as BillingType[]}
                  translate={translateBillingType}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={(v) => set({ status: v, page: 1 })}
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
                  <TableCell>
                    <TableLink to={`/clientes/${contract.client.id}`}>
                      {contract.client.name}
                    </TableLink>
                  </TableCell>
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

      <Pagination
        page={page}
        pageSize={LIMIT}
        total={total}
        onPageChange={(p) => set({ page: p })}
        labelSingular="contrato"
        labelPlural="contratos"
      />

      <ContratoFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
