import { useState } from 'react';
import { toast } from 'sonner';
import { Laptop, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { extractApiMessage } from '@/lib/api-error';
import { formatRelativeTime } from '@/lib/format';
import { useRevokeOtherSessions, useRevokeSession, useSessions } from './api/hooks';
import type { Session } from './api/perfil.api';

/** Aba "Dispositivos" de `/configuracoes`: as sessões abertas nesta conta. */
export function SessoesAtivas() {
  const { data: sessions, isLoading, isError } = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const [revoking, setRevoking] = useState<Session | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);

  const outras = (sessions ?? []).filter((s) => !s.current).length;

  const confirmRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast.success('Sessão encerrada.');
      setRevoking(null);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao encerrar a sessão.'));
    }
  };

  const confirmRevokeOthers = async () => {
    try {
      const { revoked } = await revokeOthers.mutateAsync();
      toast.success(
        revoked === 1 ? '1 sessão encerrada.' : `${revoked} sessões encerradas.`,
      );
      setOthersOpen(false);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao encerrar as outras sessões.'));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">Dispositivos</h2>
          <p className="text-sm text-muted-foreground">
            Dispositivos com acesso à sua conta. Encerrar uma sessão desconecta
            aquele dispositivo na próxima ação dele.
          </p>
        </div>
        {outras > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setOthersOpen(true)}
          >
            <LogOut data-icon="inline-start" />
            Encerrar as outras
          </Button>
        )}
      </div>

      {isError ? (
        <p className="text-sm text-muted-foreground">
          Falha ao carregar as sessões.
        </p>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {(sessions ?? []).map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Laptop className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {session.device}
                    </span>
                    {session.current && (
                      <Badge variant="secondary">Esta sessão</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[session.ip, `último uso ${formatRelativeTime(session.lastUsedAt)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              {!session.current && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevoking(session)}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Encerrar esta sessão?"
        description={`"${revoking?.device}" perde o acesso na próxima ação. Será preciso entrar de novo naquele dispositivo.`}
        confirmLabel="Encerrar"
        pendingLabel="Encerrando…"
        destructive
        pending={revoke.isPending}
        onConfirm={() => void confirmRevoke()}
      />

      <ConfirmDialog
        open={othersOpen}
        onOpenChange={setOthersOpen}
        title="Encerrar as outras sessões?"
        description={`${outras === 1 ? '1 dispositivo' : `${outras} dispositivos`} perde o acesso na próxima ação. Esta sessão continua ativa.`}
        confirmLabel="Encerrar"
        pendingLabel="Encerrando…"
        destructive
        pending={revokeOthers.isPending}
        onConfirm={() => void confirmRevokeOthers()}
      />
    </section>
  );
}
