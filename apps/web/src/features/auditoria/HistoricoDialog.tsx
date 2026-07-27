import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { translateAuditAction, translateAuditActorType } from '@/lib/labels';
import { DiffView } from './components/DiffView';
import { useAuditByEntity } from './api/hooks';
import type { AuditEntity } from './api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: AuditEntity;
  entityId: string;
  /** Nome do registro, para o cabeçalho do diálogo. */
  label: string;
}

/**
 * Histórico de mudanças de **um** registro, em ordem cronológica reversa.
 *
 * Reutilizável em qualquer tela de detalhe: basta a entidade e o id. A consulta
 * só roda com o diálogo aberto.
 */
export function HistoricoDialog({
  open,
  onOpenChange,
  entity,
  entityId,
  label,
}: Props) {
  const { data, isLoading, isError } = useAuditByEntity(entity, entityId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico</DialogTitle>
          <DialogDescription>
            Mudanças registradas em {label}, da mais recente para a mais antiga.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isError ? (
            <p role="alert" className="text-sm text-destructive">
              Falha ao carregar o histórico.
            </p>
          ) : isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : data && data.length > 0 ? (
            <ol className="flex flex-col gap-4">
              {data.map((entrada) => (
                <li
                  key={entrada.id}
                  className="flex flex-col gap-1.5 border-l-2 pl-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {translateAuditAction(entrada.action)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      por {entrada.actorName}
                    </span>
                    {entrada.actorType !== 'USER' && (
                      <Badge variant="secondary">
                        {translateAuditActorType(entrada.actorType)}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(entrada.createdAt)}
                    </span>
                  </div>
                  <DiffView diff={entrada.diff} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma mudança registrada para este registro.
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
