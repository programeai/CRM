import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  Bell,
  BookOpen,
  KeyRound,
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
import { CopyBox } from '@/components/ui/copy-box';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { extractApiMessage } from '@/lib/api-error';
import { useCan } from '@/hooks/use-can';
import { translateNotificationChannelKind } from '@/lib/labels';
import { cn } from '@/lib/utils';
import {
  useAtualizarDestino,
  useDestinos,
  useExcluirDestino,
  useRotacionarSegredo,
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

/** O segredo recém-gerado, exibido uma única vez. */
interface SegredoNovo {
  segredo: string;
  rotulo: string;
  /** Rotação avisa que a assinatura anterior morreu; criação, não. */
  rotacionado: boolean;
}

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
  const rotacionar = useRotacionarSegredo();
  // O backend é a autoridade (403 pelo AccessGuard); aqui só evitamos mostrar a
  // ação que não seria aceita.
  const { can } = useCan();
  const podeIntegrar = can('notificacao:integrar');

  const [excluindo, setExcluindo] = useState<DestinoDeNotificacao | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [integracaoAberta, setIntegracaoAberta] = useState(false);
  const [rotacionando, setRotacionando] =
    useState<DestinoDeNotificacao | null>(null);
  const [segredoNovo, setSegredoNovo] = useState<SegredoNovo | null>(null);

  const confirmarRotacao = async () => {
    if (!rotacionando) return;
    try {
      const { segredo } = await rotacionar.mutateAsync(rotacionando.id);
      const rotulo = rotacionando.label;
      setRotacionando(null);
      // Diálogo PRÓPRIO, nunca empilhado sobre o de confirmação.
      setSegredoNovo({ segredo, rotulo, rotacionado: true });
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao rotacionar o segredo.'));
    }
  };

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
                    {/* Só o kind WEBHOOK verifica assinatura: Slack, Discord e
                        Telegram não têm onde conferir, e um botão de segredo ali
                        seria uma ação sem consequência. */}
                    {destino.kind === 'WEBHOOK' && podeIntegrar && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRotacionando(destino)}
                      >
                        <KeyRound data-icon="inline-start" />
                        Rotacionar segredo
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
          onSegredoGerado={({ segredo, rotulo }) =>
            setSegredoNovo({ segredo, rotulo, rotacionado: false })
          }
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

      <ConfirmDialog
        open={!!rotacionando}
        onOpenChange={(open) => !open && setRotacionando(null)}
        title="Rotacionar o segredo deste webhook?"
        description="A assinatura passa a ser calculada com o segredo novo imediatamente. Quem estiver verificando com o antigo passa a recusar as entregas até você trocar o valor do outro lado."
        confirmLabel="Rotacionar"
        pendingLabel="Rotacionando…"
        destructive
        pending={rotacionar.isPending}
        onConfirm={() => void confirmarRotacao()}
      />

      {/* Diálogo próprio: NUNCA empilhado sobre o de confirmação da rotação. */}
      <Dialog
        open={!!segredoNovo}
        onOpenChange={(open) => !open && setSegredoNovo(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {segredoNovo?.rotacionado
                ? 'Segredo rotacionado'
                : 'Segredo de assinatura'}
            </DialogTitle>
            <DialogDescription>
              {segredoNovo?.rotacionado
                ? `Este é o segredo novo de "${segredoNovo.rotulo}". O anterior já não vale — troque o valor no receptor agora.`
                : `Use este segredo para verificar o cabeçalho X-CRM-Signature das entregas de "${segredoNovo?.rotulo ?? 'este webhook'}", e confirmar que elas vieram do CRM.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {segredoNovo && (
              <CopyBox
                value={segredoNovo.segredo}
                copiedLabel="Segredo copiado."
              >
                Copie agora. Esta é a única vez que o segredo aparece — se
                perder, rotacione para gerar outro.
              </CopyBox>
            )}
            <p className="text-xs text-muted-foreground">
              Como verificar a assinatura está em{' '}
              <Link
                to="/ajuda/notificacoes#assinatura"
                className="font-medium text-primary hover:underline"
              >
                Ajuda → Notificações
              </Link>
              .
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => setSegredoNovo(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
