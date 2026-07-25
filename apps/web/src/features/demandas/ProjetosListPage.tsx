import { useEffect, useState } from 'react';
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
  PROJECT_STATUS_LABELS,
  translateProjectStatus,
  translateServiceType,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  enumFilter,
  numberFilter,
  stringFilter,
  useUrlFilters,
} from '@/hooks/use-url-filters';
import { useProjects } from './api/hooks';
import { PROJECT_STATUS_BADGE } from './lib/project-format';
import { ProjectFormDialog } from './ProjectFormDialog';
import type { ProjectStatus } from './api/types';

const LIMIT = 20;

/** Filtros da listagem persistidos na URL (sobrevivem à ida/volta de uma tela de detalhe). */
const PROJETOS_FILTERS = {
  search: stringFilter(),
  status: enumFilter(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[], 'ALL' as const),
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

export default function ProjetosListPage() {
  const { values, set } = useUrlFilters(PROJETOS_FILTERS);
  const { status, page } = values;
  const [formOpen, setFormOpen] = useState(false);

  const [search, setSearch] = useState(values.search);
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== values.search) set({ search: debounced, page: 1 });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useProjects({
    page,
    limit: LIMIT,
    search: values.search || undefined,
    status: status === 'ALL' ? undefined : status,
  });

  const total = data?.meta.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Projetos</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Novo projeto
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <SearchInput
          className="max-w-xs"
          placeholder="Buscar por nome…"
          value={search}
          onValueChange={setSearch}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo de serviço</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={(v) => set({ status: v, page: 1 })}
                  options={Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]}
                  translate={translateProjectStatus}
                />
              </TableHead>
              <TableHead>Tarefas</TableHead>
              <TableHead>Prazo</TableHead>
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
              data.data.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <TableLink to={`/projetos/${project.id}`}>{project.name}</TableLink>
                  </TableCell>
                  <TableCell>
                    <TableLink to={`/clientes/${project.client.id}`}>
                      {project.client.name}
                    </TableLink>
                  </TableCell>
                  <TableCell>{translateServiceType(project.serviceType)}</TableCell>
                  <TableCell>
                    <Badge variant={PROJECT_STATUS_BADGE[project.status]}>
                      {translateProjectStatus(project.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{project._count.tasks}</TableCell>
                  <TableCell>{formatDate(project.dueDate) || '—'}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={6}>Nenhum projeto encontrado.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={LIMIT}
        total={total}
        onPageChange={(p) => set({ page: p })}
        labelSingular="projeto"
        labelPlural="projetos"
      />

      <ProjectFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
