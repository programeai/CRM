import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCan } from '@/hooks/use-can';
import { TRASH_TYPE_LABELS, translateTrashType } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import { extractApiMessage } from '@/lib/api-error';
import { enumFilter, numberFilter, useUrlFilters } from '@/hooks/use-url-filters';
import { useRestoreItem, usePurgeItem, useTrash } from './api/hooks';
import type { TrashItem, TrashType } from './api/types';

const LIMIT = 20;

const TRASH_TYPES = Object.keys(TRASH_TYPE_LABELS) as TrashType[];

/** Filtros da listagem persistidos na URL (sobrevivem à ida/volta de outra tela). */
const LIXEIRA_FILTERS = {
  type: enumFilter(TRASH_TYPES, 'ALL' as const),
  page: numberFilter(1),
};

export default function LixeiraPage() {
  const { values, set } = useUrlFilters(LIXEIRA_FILTERS);
  const { type, page } = values;
  const { can } = useCan();

  const [restoring, setRestoring] = useState<TrashItem | null>(null);
  const [purging, setPurging] = useState<TrashItem | null>(null);

  const { data, isLoading, isError } = useTrash({
    page,
    limit: LIMIT,
    type: type === 'ALL' ? undefined : type,
  });
  const restore = useRestoreItem();
  const purge = usePurgeItem();

  const itens = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  const confirmRestore = async () => {
    if (!restoring) return;
    try {
      await restore.mutateAsync({ type: restoring.type, id: restoring.id });
      toast.success('Registro restaurado.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao restaurar.'));
    } finally {
      setRestoring(null);
    }
  };

  const confirmPurge = async () => {
    if (!purging) return;
    try {
      await purge.mutateAsync({ type: purging.type, id: purging.id });
      toast.success('Registro excluído em definitivo.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao excluir em definitivo.'));
    } finally {
      setPurging(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Lixeira</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Registros arquivados. Restaure para devolvê-los às listagens ou exclua
        em definitivo — o que não tem volta.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select<TrashType | 'ALL'>
          items={{ ALL: 'Todos os tipos', ...TRASH_TYPE_LABELS }}
          value={type}
          onValueChange={(v) => set({ type: v ?? 'ALL', page: 1 })}
        >
          <SelectTrigger className="w-56" />
          <SelectContent>
            <SelectItem value="ALL">Todos os tipos</SelectItem>
            {TRASH_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {translateTrashType(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Arquivado em</TableHead>
              <TableHead className="w-px text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableEmpty colSpan={4}>Falha ao carregar a lixeira.</TableEmpty>
            ) : isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : itens.length > 0 ? (
              itens.map((item) => (
                <TableRow key={`${item.type}-${item.id}`}>
                  <TableCell>
                    <Badge variant="secondary">
                      {translateTrashType(item.type)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span>{item.label}</span>
                      {item.context && (
                        <span className="text-xs text-muted-foreground">
                          {item.context}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(item.archivedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRestoring(item)}
                      >
                        Restaurar
                      </Button>
                      {can('lixeira:expurgar') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setPurging(item)}
                        >
                          Excluir em definitivo
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={4}>A lixeira está vazia.</TableEmpty>
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

      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(open) => !open && setRestoring(null)}
        title="Restaurar registro?"
        description={`“${restoring?.label}” volta para as listagens de origem.`}
        confirmLabel="Restaurar"
        pendingLabel="Restaurando…"
        pending={restore.isPending}
        onConfirm={() => void confirmRestore()}
      />

      <ConfirmDialog
        open={!!purging}
        onOpenChange={(open) => !open && setPurging(null)}
        title="Excluir em definitivo?"
        description={`“${purging?.label}” será apagado do banco de dados. Esta ação não tem volta e o registro não poderá ser recuperado.`}
        confirmLabel="Excluir em definitivo"
        pendingLabel="Excluindo…"
        destructive
        pending={purge.isPending}
        onConfirm={() => void confirmPurge()}
      />
    </div>
  );
}
