import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColumnFilter } from '@/components/ui/column-filter';
import { SearchInput } from '@/components/ui/search-input';
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
  PROPOSAL_STATUS_LABELS,
  translateProposalStatus,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  enumFilter,
  numberFilter,
  stringFilter,
  useUrlFilters,
} from '@/hooks/use-url-filters';
import { useProposals } from './api/hooks';
import { formatMoney } from './lib/proposal-format';
import { ProposalFormDialog } from './ProposalFormDialog';
import type { ProposalStatus } from './api/types';

const STATUS_BADGE: Record<ProposalStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'outline',
  NEGOTIATING: 'outline',
  ACCEPTED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
};

const LIMIT = 20;

/** Filtros da listagem persistidos na URL (sobrevivem à ida/volta de uma tela de detalhe). */
const PROPOSTAS_FILTERS = {
  search: stringFilter(),
  status: enumFilter(Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[], 'ALL' as const),
  page: numberFilter(1),
};

/**
 * Cabeçalho de coluna com filtro de opção única (mesmo padrão de `ClientesListPage`,
 * replicado localmente para não alterar a feature `clientes` nesta fase).
 */
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

export default function PropostasListPage() {
  const { values, set } = useUrlFilters(PROPOSTAS_FILTERS);
  const { status, page } = values;
  const [formOpen, setFormOpen] = useState(false);

  const [search, setSearch] = useState(values.search);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debouncedSearch !== values.search) set({ search: debouncedSearch, page: 1 });
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useProposals({
    page,
    limit: LIMIT,
    search: values.search || undefined,
    status: status === 'ALL' ? undefined : status,
  });

  const total = data?.meta.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Propostas</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Nova proposta
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-xs"
          placeholder="Buscar por cliente ou número…"
          value={search}
          onValueChange={setSearch}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Número</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo de serviço</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={(v) => set({ status: v, page: 1 })}
                  options={Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[]}
                  translate={translateProposalStatus}
                />
              </TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Validade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data && data.data.length > 0 ? (
              data.data.map((proposal) => (
                <TableRow key={proposal.id}>
                  <TableCell>
                    <TableLink to={`/propostas/${proposal.id}`}>
                      {proposal.number} · v{proposal.version}
                    </TableLink>
                  </TableCell>
                  <TableCell>
                    <TableLink to={`/clientes/${proposal.client.id}`}>
                      {proposal.client.name}
                    </TableLink>
                  </TableCell>
                  <TableCell>{proposal.serviceType.name}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[proposal.status]}>
                      {translateProposalStatus(proposal.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatMoney(proposal.total)}
                    {proposal.billingType === 'RECURRING' && (
                      <span className="text-muted-foreground"> /mês</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(proposal.validUntil) || '—'}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={6}>Nenhuma proposta encontrada.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={LIMIT}
        total={total}
        onPageChange={(p) => set({ page: p })}
        labelSingular="proposta"
        labelPlural="propostas"
      />

      <ProposalFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
