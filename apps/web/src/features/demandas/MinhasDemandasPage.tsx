import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ColumnFilter } from '@/components/ui/column-filter';
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
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  translateTaskPriority,
  translateTaskStatus,
} from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClientOptions, useTasks } from './api/hooks';
import { isOverdue } from './lib/overdue';
import { TASK_PRIORITY_BADGE } from './lib/project-format';
import type { Task, TaskPriority, TaskStatus } from './api/types';

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

export default function MinhasDemandasPage() {
  const [priority, setPriority] = useState<TaskPriority | 'ALL'>('ALL');
  const [status, setStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | undefined>();
  const [dueBefore, setDueBefore] = useState('');

  const debouncedClientSearch = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debouncedClientSearch);

  const { data, isLoading } = useTasks({
    limit: LIMIT,
    priority: priority === 'ALL' ? undefined : priority,
    status: status === 'ALL' ? undefined : status,
    clientId,
    dueBefore: dueBefore || undefined,
  });

  const tasks: Task[] = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Minhas demandas</h1>
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
          type="date"
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={dueBefore}
          onChange={(e) => setDueBefore(e.target.value)}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tarefa</TableHead>
              <TableHead>Projeto</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Prioridade"
                  name="priority-filter"
                  value={priority}
                  onValueChange={setPriority}
                  options={Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]}
                  translate={translateTaskPriority}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={setStatus}
                  options={Object.keys(TASK_STATUS_LABELS) as TaskStatus[]}
                  translate={translateTaskStatus}
                />
              </TableHead>
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
            ) : tasks.length > 0 ? (
              tasks.map((task) => {
                const overdue = isOverdue(task);
                return (
                  <TableRow key={task.id}>
                    <TableCell>
                      <TableLink to={`/projetos/${task.project.id}`}>{task.title}</TableLink>
                    </TableCell>
                    <TableCell>
                      <TableLink to={`/projetos/${task.project.id}`}>{task.project.name}</TableLink>
                    </TableCell>
                    <TableCell>
                      <TableLink to={`/clientes/${task.project.client.id}`}>
                        {task.project.client.name}
                      </TableLink>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TASK_PRIORITY_BADGE[task.priority]}>
                        {translateTaskPriority(task.priority)}
                      </Badge>
                    </TableCell>
                    <TableCell>{translateTaskStatus(task.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={overdue ? 'text-destructive' : undefined}>
                          {formatDate(task.dueDate) || '—'}
                        </span>
                        {overdue && <Badge variant="destructive">Atrasada</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableEmpty colSpan={6}>Nenhuma tarefa encontrada.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
