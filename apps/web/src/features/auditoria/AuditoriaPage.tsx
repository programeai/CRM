import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ColumnFilter } from '@/components/ui/column-filter';
import { SectionHeading } from '@/components/ui/section-heading';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  translateAuditAction,
  translateAuditActorType,
  translateAuditEntity,
} from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import { useWorkspaceMembers } from '@/lib/members-lookup';
import {
  enumFilter,
  numberFilter,
  stringFilter,
  useUrlFilters,
} from '@/hooks/use-url-filters';
import { DiffView } from './components/DiffView';
import { useAudit } from './api/hooks';
import type { AuditAction, AuditEntity, AuditLog } from './api/types';

const LIMIT = 25;

const ENTITIES = Object.keys(AUDIT_ENTITY_LABELS) as AuditEntity[];
const ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];

/** Sentinela do "sem filtro" — o `Select` do base-ui não aceita valor vazio. */
const TODOS = 'all';

/** Filtros da listagem persistidos na URL (sobrevivem à ida/volta de outra tela). */
const AUDITORIA_FILTERS = {
  entity: enumFilter(ENTITIES, 'ALL' as const),
  action: enumFilter(ACTIONS, 'ALL' as const),
  actorId: stringFilter(),
  from: stringFilter(),
  to: stringFilter(),
  page: numberFilter(1),
};

/** Cabeçalho de coluna com filtro de opção única (mesmo padrão de `RecebimentosPage`). */
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
      contentClassName="w-56"
    >
      <div className="max-h-72 space-y-1 overflow-y-auto">
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

export default function AuditoriaPage() {
  const { values, set } = useUrlFilters(AUDITORIA_FILTERS);
  const { entity, action, actorId, page } = values;
  const [detalhe, setDetalhe] = useState<AuditLog | null>(null);

  // O lookup de membros resolve o nome inclusive de colaborador desativado.
  const { data: members } = useWorkspaceMembers();

  const periodo: DateRange | undefined =
    values.from || values.to
      ? { from: values.from || undefined, to: values.to || undefined }
      : undefined;

  const { data, isLoading, isError } = useAudit({
    page,
    limit: LIMIT,
    entity: entity === 'ALL' ? undefined : entity,
    action: action === 'ALL' ? undefined : action,
    actorId: actorId || undefined,
    from: values.from || undefined,
    to: values.to || undefined,
  });

  const entradas: AuditLog[] = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  const memberItems: Record<string, string> = {
    [TODOS]: 'Todos os autores',
  };
  for (const m of members ?? []) memberItems[m.id] = m.name;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Auditoria"
        description="Toda mudança sensível de estado do CRM, com quem fez e quando. O registro guarda o nome que valia no momento da ação."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select<string>
          items={memberItems}
          value={actorId || TODOS}
          onValueChange={(v) =>
            set({ actorId: !v || v === TODOS ? '' : (v as string), page: 1 })
          }
        >
          <SelectTrigger className="w-56" />
          <SelectContent>
            <SelectItem value={TODOS}>Todos os autores</SelectItem>
            {(members ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          className="ml-auto"
          value={periodo}
          onChange={(range) =>
            set({ from: range?.from ?? '', to: range?.to ?? '', page: 1 })
          }
          placeholder="Período"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Quem</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Ação"
                  name="audit-action-filter"
                  value={action}
                  onValueChange={(v) => set({ action: v, page: 1 })}
                  options={ACTIONS}
                  translate={translateAuditAction}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Tipo"
                  name="audit-entity-filter"
                  value={entity}
                  onValueChange={(v) => set({ entity: v, page: 1 })}
                  options={ENTITIES}
                  translate={translateAuditEntity}
                />
              </TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableEmpty colSpan={6}>Falha ao carregar a auditoria.</TableEmpty>
            ) : isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : entradas.length > 0 ? (
              entradas.map((entrada) => (
                <TableRow key={entrada.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(entrada.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{entrada.actorName}</span>
                      {entrada.actorType !== 'USER' && (
                        <Badge variant="secondary">
                          {translateAuditActorType(entrada.actorType)}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{translateAuditAction(entrada.action)}</TableCell>
                  <TableCell>{translateAuditEntity(entrada.entity)}</TableCell>
                  <TableCell>{entrada.entityLabel}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDetalhe(entrada)}
                    >
                      Detalhes
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={6}>
                Nenhuma mudança registrada com estes filtros.
              </TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={LIMIT}
        total={total}
        onPageChange={(p) => set({ page: p })}
        labelSingular="registro"
        labelPlural="registros"
      />

      <Dialog
        open={detalhe !== null}
        onOpenChange={(open) => {
          if (!open) setDetalhe(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Detalhes da mudança</DialogTitle>
            {detalhe && (
              <DialogDescription>
                {translateAuditAction(detalhe.action)}{' '}
                {translateAuditEntity(detalhe.entity).toLowerCase()}{' '}
                {detalhe.entityLabel} — por {detalhe.actorName} em{' '}
                {formatDateTime(detalhe.createdAt)}.
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogBody>
            {detalhe && <DiffView diff={detalhe.diff} />}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
