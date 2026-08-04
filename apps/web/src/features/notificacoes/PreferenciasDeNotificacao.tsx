import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  Bell,
  BookOpen,
  Mail,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { extractApiMessage } from '@/lib/api-error';
import { useCan } from '@/hooks/use-can';
import { translateNotificationChannelKind } from '@/lib/labels';
import { cn } from '@/lib/utils';
import {
  useAtualizarDestino,
  useDestinos,
  useExcluirDestino,
  useVerificarDestino,
} from './api/hooks';
import { DestinoEmailDialog } from './DestinoEmailDialog';
import { IntegracaoDialog } from './IntegracaoDialog';
import { MatrizDeTipos } from './MatrizDeTipos';
import type {
  DestinoDeNotificacao,
  NotificationChannelKind,
  NotificationType,
} from './api/types';

const ICONE: Record<NotificationChannelKind, typeof Bell> = {
  IN_APP: Bell,
  EMAIL: Mail,
  WEBHOOK: Webhook,
  SLACK: Webhook,
  DISCORD: MessageCircle,
  TELEGRAM: Send,
};

/**
 * Aba "Notificações" de `/configuracoes`: os destinos de e-mail e as
 * integrações (Slack, Discord, Telegram, webhook) numa lista só — é uma lista
 * só no servidor, e o que muda entre elas é o `kind`. O cadastro dos dois sai
 * em Dialog (padrão da aplicação); a tela mostra a lista.
 */
export function PreferenciasDeNotificacao() {
  const { data: destinos, isLoading, isError } = useDestinos();
  const atualizar = useAtualizarDestino();
  const excluir = useExcluirDestino();
  const verificar = useVerificarDestino();
  // O backend é a autoridade (403 pelo AccessGuard); aqui só evitamos mostrar a
  // ação que não seria aceita.
  const { can } = useCan();
  const podeIntegrar = can('notificacao:integrar');

  const [excluindo, setExcluindo] = useState<DestinoDeNotificacao | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [integracaoAberta, setIntegracaoAberta] = useState(false);

  const confirmarVerificacao = async (destino: DestinoDeNotificacao) => {
    try {
      await verificar.mutateAsync(destino.id);
      toast.success('Integração verificada e ativada.');
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao verificar a integração.'));
    }
  };

  const alternarTipo = async (
    destino: DestinoDeNotificacao,
    tipo: NotificationType,
    marcado: boolean,
  ) => {
    const types = marcado
      ? [...destino.types, tipo]
      : destino.types.filter((t) => t !== tipo);
    try {
      await atualizar.mutateAsync({ id: destino.id, body: { types } });
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao salvar a preferência.'));
    }
  };

  const alternarAtivo = async (
    destino: DestinoDeNotificacao,
    active: boolean,
  ) => {
    try {
      await atualizar.mutateAsync({ id: destino.id, body: { active } });
      toast.success(active ? 'Destino ativado.' : 'Destino desativado.');
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao alterar o destino.'));
    }
  };

  const confirmarExclusao = async () => {
    if (!excluindo) return;
    try {
      await excluir.mutateAsync(excluindo.id);
      toast.success('Destino removido.');
      setExcluindo(null);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao remover o destino.'));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">Notificações</h2>
          <p className="text-sm text-muted-foreground">
            Escolha onde receber cada aviso. Desativar um destino para de
            entregar nele — o histórico continua na central.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* `cn` obrigatório: sem o merge, o `border-transparent` da base do
              botão vence o `border-border` da variante e o contorno some. */}
          <Link
            to="/ajuda/notificacoes"
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            <BookOpen data-icon="inline-start" />
            Como integrar
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={() => setNovoAberto(true)}
          >
            <Plus data-icon="inline-start" />
            Novo e-mail
          </Button>
          {podeIntegrar && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setIntegracaoAberta(true)}
            >
              <Webhook data-icon="inline-start" />
              Nova integração
            </Button>
          )}
        </div>
      </div>

      {isError ? (
        <p className="text-sm text-muted-foreground">
          Falha ao carregar os destinos de notificação.
        </p>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {(destinos ?? []).map((destino) => {
            const Icone = ICONE[destino.kind];
            return (
              <li
                key={destino.id}
                className="flex flex-col gap-3 rounded-md border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icone className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {destino.label}
                        </span>
                        <Badge variant="secondary">
                          {translateNotificationChannelKind(destino.kind)}
                        </Badge>
                        {!destino.verified && (
                          <Badge variant="outline">Não verificado</Badge>
                        )}
                      </div>
                      {destino.configResumo && (
                        <p className="truncate text-xs text-muted-foreground">
                          {destino.configResumo}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {!destino.verified && podeIntegrar && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={verificar.isPending}
                        onClick={() => void confirmarVerificacao(destino)}
                      >
                        {verificar.isPending ? 'Testando…' : 'Testar e ativar'}
                      </Button>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={destino.active}
                        disabled={!destino.verified}
                        onCheckedChange={(marcado) =>
                          void alternarAtivo(destino, marcado === true)
                        }
                      />
                      Ativo
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${destino.label}`}
                      onClick={() => setExcluindo(destino)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <MatrizDeTipos
                    selecionados={destino.types}
                    disabled={!destino.active}
                    onAlternar={(tipo, marcado) =>
                      void alternarTipo(destino, tipo, marcado)
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <DestinoEmailDialog open={novoAberto} onOpenChange={setNovoAberto} />
      {podeIntegrar && (
        <IntegracaoDialog
          open={integracaoAberta}
          onOpenChange={setIntegracaoAberta}
        />
      )}

      <ConfirmDialog
        open={!!excluindo}
        onOpenChange={(open) => !open && setExcluindo(null)}
        title="Remover este destino?"
        description={`"${excluindo?.label}" para de receber notificações. O histórico já entregue continua na central.`}
        confirmLabel="Remover"
        pendingLabel="Removendo…"
        destructive
        pending={excluir.isPending}
        onConfirm={() => void confirmarExclusao()}
      />
    </section>
  );
}
