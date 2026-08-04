import { useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, KeyRound, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { SectionHeading } from '@/components/ui/section-heading';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { extractApiMessage } from '@/lib/api-error';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { WebhookDialog } from './WebhookDialog';
import {
  useEventosDeWebhook,
  useExcluirWebhook,
  useRotacionarSegredoDoWebhook,
  useVerificarWebhook,
  useWebhooks,
} from './api/hooks';
import type { Webhook } from './api/types';

/** O segredo recém-gerado, exibido uma única vez. */
interface SegredoNovo {
  segredo: string;
  nome: string;
  /** Rotação avisa que a assinatura anterior morreu; cadastro, não. */
  rotacionado: boolean;
}

export default function WebhooksPage() {
  const { data: webhooks, isLoading } = useWebhooks();
  const { data: eventos } = useEventosDeWebhook();
  const verificar = useVerificarWebhook();
  const rotacionar = useRotacionarSegredoDoWebhook();
  const excluir = useExcluirWebhook();

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<Webhook | null>(null);
  const [rotacionando, setRotacionando] = useState<Webhook | null>(null);
  const [excluindo, setExcluindo] = useState<Webhook | null>(null);
  const [segredoNovo, setSegredoNovo] = useState<SegredoNovo | null>(null);

  // Rótulo em pt-BR de cada evento — o front nunca duplica esse texto.
  const rotuloPorEvento = new Map(
    (eventos ?? []).map((e) => [e.key, e.label] as const),
  );

  const abrirCadastro = () => {
    setEditando(null);
    setFormOpen(true);
  };

  const abrirEdicao = (webhook: Webhook) => {
    setEditando(webhook);
    setFormOpen(true);
  };

  const confirmarVerificacao = async (webhook: Webhook) => {
    try {
      await verificar.mutateAsync(webhook.id);
      toast.success('Webhook verificado e ativado.');
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao verificar o webhook.'));
    }
  };

  const confirmarRotacao = async () => {
    if (!rotacionando) return;
    try {
      const { segredo } = await rotacionar.mutateAsync(rotacionando.id);
      const nome = rotacionando.nome;
      setRotacionando(null);
      // Diálogo PRÓPRIO, nunca empilhado sobre o de confirmação.
      setSegredoNovo({ segredo, nome, rotacionado: true });
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao rotacionar o segredo.'));
    }
  };

  const confirmarExclusao = async () => {
    if (!excluindo) return;
    try {
      await excluir.mutateAsync(excluindo.id);
      toast.success('Webhook excluído. Ele para de receber eventos.');
      setExcluindo(null);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao excluir o webhook.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Webhooks"
        description="Endereços que recebem os eventos de negócio da workspace — lead recebido, cobrança vencida, demanda atrasada. Cada entrega vai assinada."
      >
        <Link
          to="/ajuda/webhooks"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          <BookOpen data-icon="inline-start" />
          Como integrar
        </Link>
        <Button onClick={abrirCadastro}>
          <Plus data-icon="inline-start" />
          Novo webhook
        </Button>
      </SectionHeading>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Eventos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead className="w-px text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : webhooks && webhooks.length > 0 ? (
                webhooks.map((webhook) => (
                  <TableRow key={webhook.id}>
                    <TableCell>
                      <span className="font-medium">{webhook.nome}</span>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {webhook.host ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {webhook.eventos.map((key) => (
                          <Badge key={key} variant="secondary">
                            {rotuloPorEvento.get(key) ?? key}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {!webhook.verificadoEm ? (
                        <Badge variant="outline">Não verificado</Badge>
                      ) : webhook.ativo ? (
                        <Badge>Ativo</Badge>
                      ) : (
                        <Badge variant="destructive">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {webhook.ultimoUsoEm ? (
                        formatDate(webhook.ultimoUsoEm)
                      ) : (
                        <span className="text-muted-foreground">
                          Nunca usado
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {!webhook.verificadoEm && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={verificar.isPending}
                            onClick={() => void confirmarVerificacao(webhook)}
                          >
                            {verificar.isPending ? 'Testando…' : 'Verificar'}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => abrirEdicao(webhook)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRotacionando(webhook)}
                        >
                          <KeyRound data-icon="inline-start" />
                          Rotacionar segredo
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExcluindo(webhook)}
                        >
                          Excluir
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={5}>
                  Nenhum webhook ainda. Cadastre um para os eventos da workspace
                  chegarem na sua automação.
                </TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <WebhookDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        webhook={editando}
        onCriado={({ segredo, nome }) =>
          setSegredoNovo({ segredo, nome, rotacionado: false })
        }
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

      <ConfirmDialog
        open={!!excluindo}
        onOpenChange={(open) => !open && setExcluindo(null)}
        title="Excluir este webhook?"
        description={`"${excluindo?.nome ?? 'Este webhook'}" para de receber eventos na hora, e as entregas que ainda estavam na fila são descartadas.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        pending={excluir.isPending}
        onConfirm={() => void confirmarExclusao()}
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
                : 'Webhook criado'}
            </DialogTitle>
            <DialogDescription>
              {segredoNovo?.rotacionado
                ? `Este é o segredo novo de "${segredoNovo.nome}". O anterior já não vale — troque o valor no receptor agora.`
                : `Use este segredo para verificar o cabeçalho X-CRM-Signature das entregas de "${segredoNovo?.nome ?? 'este webhook'}". O webhook está inativo: use "Verificar" para ativá-lo.`}
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
                to="/ajuda/webhooks#assinatura"
                className="font-medium text-primary hover:underline"
              >
                Ajuda → Webhooks
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
    </div>
  );
}
