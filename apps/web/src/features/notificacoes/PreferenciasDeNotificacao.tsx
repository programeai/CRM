import { useState } from 'react';
import { toast } from 'sonner';
import { Bell, Mail, Plus, Trash2, Webhook } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { extractApiMessage } from '@/lib/api-error';
import { useCan } from '@/hooks/use-can';
import {
  NOTIFICATION_TYPE_LABELS,
  translateNotificationChannelKind,
  translateNotificationType,
} from '@/lib/labels';
import {
  useAtualizarDestino,
  useCriarDestino,
  useCriarIntegracao,
  useDestinos,
  useExcluirDestino,
  useVerificarDestino,
} from './api/hooks';
import type {
  DestinoDeNotificacao,
  NotificationChannelKind,
  NotificationType,
} from './api/types';

/** Os seis tipos, na ordem do catálogo — o map de rótulos é a fonte da ordem. */
const TIPOS = Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[];

const ICONE: Record<NotificationChannelKind, typeof Bell> = {
  IN_APP: Bell,
  EMAIL: Mail,
  WEBHOOK: Webhook,
  SLACK: Webhook,
};

interface PreferenciasDeNotificacaoProps {
  /** Só busca quando o diálogo está aberto — evita requisição em tela fechada. */
  enabled: boolean;
}

export function PreferenciasDeNotificacao({
  enabled,
}: PreferenciasDeNotificacaoProps) {
  const { data: destinos, isLoading, isError } = useDestinos({ enabled });
  const atualizar = useAtualizarDestino();
  const excluir = useExcluirDestino();
  const verificar = useVerificarDestino();
  // O backend é a autoridade (403 pelo AccessGuard); aqui só evitamos mostrar o
  // formulário que não seria aceito.
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
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Notificações</h3>
          <p className="text-xs text-muted-foreground">
            Escolha onde receber cada aviso. Desativar um destino para de
            entregar nele — o histórico continua na central.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!novoAberto && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNovoAberto(true)}
            >
              <Plus data-icon="inline-start" />
              Novo e-mail
            </Button>
          )}
          {podeIntegrar && !integracaoAberta && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIntegracaoAberta(true)}
            >
              <Webhook data-icon="inline-start" />
              Nova integração
            </Button>
          )}
        </div>
      </div>

      {novoAberto && <NovoDestinoEmail onFechar={() => setNovoAberto(false)} />}
      {integracaoAberta && (
        <NovaIntegracao onFechar={() => setIntegracaoAberta(false)} />
      )}

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

                <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">
                  {TIPOS.map((tipo) => (
                    <label
                      key={tipo}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={destino.types.includes(tipo)}
                        disabled={!destino.active}
                        onCheckedChange={(marcado) =>
                          void alternarTipo(destino, tipo, marcado === true)
                        }
                      />
                      <span
                        className={
                          destino.active ? undefined : 'text-muted-foreground'
                        }
                      >
                        {translateNotificationType(tipo)}
                      </span>
                    </label>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ConfirmDialog participa da pilha `modal-stack`: o PerfilDialog é
          soterrado (mantendo o estado do formulário) e volta ao fechar. */}
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
    </div>
  );
}

/** Formulário inline de um destino de e-mail novo. */
function NovoDestinoEmail({ onFechar }: { onFechar: () => void }) {
  const criar = useCriarDestino();
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');

  const salvar = async () => {
    try {
      await criar.mutateAsync({ label: label.trim(), email: email.trim() });
      toast.success('Destino criado.');
      onFechar();
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao criar o destino.'));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="destino-label" required>
            Rótulo
          </FieldLabel>
          <Input
            id="destino-label"
            placeholder="Meu e-mail pessoal"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="destino-email" required>
            E-mail
          </FieldLabel>
          <Input
            id="destino-email"
            type="email"
            placeholder="voce@exemplo.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={criar.isPending || !label.trim() || !email.trim()}
          onClick={() => void salvar()}
        >
          {criar.isPending ? 'Criando…' : 'Criar destino'}
        </Button>
      </div>
    </div>
  );
}

/** Rótulos dos dois tipos de integração — o `Select` precisa do map. */
const KIND_INTEGRACAO = { WEBHOOK: 'Webhook', SLACK: 'Slack' } as const;
type KindIntegracao = keyof typeof KIND_INTEGRACAO;

/**
 * Formulário de um destino de integração. Só é renderizado para quem tem
 * `notificacao:integrar` — e o aviso sobre a URL ser o segredo é obrigatório:
 * quem tiver aquele endereço escreve no canal.
 */
function NovaIntegracao({ onFechar }: { onFechar: () => void }) {
  const criar = useCriarIntegracao();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<KindIntegracao>('SLACK');
  const [url, setUrl] = useState('');

  const salvar = async () => {
    try {
      await criar.mutateAsync({ label: label.trim(), kind, url: url.trim() });
      toast.success(
        'Integração criada. Use "Testar e ativar" para começar a receber.',
      );
      onFechar();
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao criar a integração.'));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">
          A URL é o segredo.
        </strong>{' '}
        Quem tiver esse endereço consegue escrever no seu canal — trate-o como
        uma senha. O conteúdo enviado carrega nome de cliente e valor de
        cobrança, então use só um destino que você controla.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="integracao-label" required>
            Rótulo
          </FieldLabel>
          <Input
            id="integracao-label"
            placeholder="Canal do time"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="integracao-kind" required>
            Serviço
          </FieldLabel>
          <Select<KindIntegracao>
            items={KIND_INTEGRACAO}
            value={kind}
            // O `onValueChange` do base-ui pode emitir null (limpar); aqui o
            // campo é obrigatório, então null mantém a escolha atual.
            onValueChange={(v) => v && setKind(v)}
          >
            <SelectTrigger id="integracao-kind" />
            <SelectContent>
              {(Object.keys(KIND_INTEGRACAO) as KindIntegracao[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_INTEGRACAO[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="integracao-url" required>
          URL (HTTPS)
        </FieldLabel>
        <Input
          id="integracao-url"
          type="url"
          placeholder="https://hooks.slack.com/services/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={criar.isPending || !label.trim() || !url.trim()}
          onClick={() => void salvar()}
        >
          {criar.isPending ? 'Criando…' : 'Criar integração'}
        </Button>
      </div>
    </div>
  );
}
