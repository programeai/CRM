import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
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
  CLIENT_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  translateClientStatus,
  translateLeadSource,
} from '@/lib/labels';
import { formatDocument, formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClients } from './api/hooks';
import type { ClientStatus, LeadSource } from './api/types';
import { ClientFormDialog } from './ClientFormDialog';

const STATUS_BADGE: Record<
  ClientStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  LEAD: 'secondary',
  ACTIVE: 'default',
  INACTIVE: 'outline',
  LOST: 'destructive',
};

const LIMIT = 20;

/**
 * Cabeçalho de coluna com filtro de opção única (padrão do design system): o
 * ícone de funil abre um popover com rádios; "Todos" (valor `ALL`) não filtra.
 * O funil fica destacado quando há filtro ativo e "Limpar filtro" volta a `ALL`.
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

export default function ClientesListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | 'ALL'>('ALL');
  const [source, setSource] = useState<LeadSource | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const debounced = useDebouncedValue(search, 300);
  const { data, isLoading } = useClients({
    page,
    limit: LIMIT,
    search: debounced || undefined,
    status: status === 'ALL' ? undefined : status,
    source: source === 'ALL' ? undefined : source,
  });

  const total = data?.meta.total ?? 0;

  const resetToFirstPage = () => setPage(1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Clientes</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Novo cliente
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="max-w-xs"
          placeholder="Buscar por nome ou documento…"
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            resetToFirstPage();
          }}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={(v) => {
                    setStatus(v);
                    resetToFirstPage();
                  }}
                  options={Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]}
                  translate={translateClientStatus}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Origem"
                  name="source-filter"
                  value={source}
                  onValueChange={(v) => {
                    setSource(v);
                    resetToFirstPage();
                  }}
                  options={Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]}
                  translate={translateLeadSource}
                />
              </TableHead>
              <TableHead>Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
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
              data.data.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <TableLink to={`/clientes/${client.id}`}>
                      {client.name}
                    </TableLink>
                  </TableCell>
                  <TableCell>{formatDocument(client.document) || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[client.status]}>
                      {translateClientStatus(client.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{translateLeadSource(client.source) || '—'}</TableCell>
                  <TableCell>{formatDate(client.createdAt)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={5}>Nenhum cliente encontrado.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={LIMIT}
        total={total}
        onPageChange={setPage}
        labelSingular="cliente"
        labelPlural="clientes"
      />

      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
