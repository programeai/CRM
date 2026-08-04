import { useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, KeyRound, Plus } from 'lucide-react';
import { toast } from 'sonner';
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
import {
  useCanaisDeCaptacao,
  useDeleteCanal,
  useRotacionarChave,
} from './api/hooks';
import { CanalDialog } from './CanalDialog';
import type { CanalDeCaptacao } from './api/types';

/** A chave recém-gerada, exibida uma única vez. */
interface ChaveNova {
  valor: string;
  nome: string;
  /** Rotação avisa que a anterior morreu; criação, não. */
  rotacionada: boolean;
}

export default function CaptacaoPage() {
  const { data: canais, isLoading } = useCanaisDeCaptacao();
  const rotacionar = useRotacionarChave();
  const remover = useDeleteCanal();

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<CanalDeCaptacao | null>(null);
  const [rotacionando, setRotacionando] = useState<CanalDeCaptacao | null>(null);
  const [excluindo, setExcluindo] = useState<CanalDeCaptacao | null>(null);
  const [chaveNova, setChaveNova] = useState<ChaveNova | null>(null);

  const abrirCriacao = () => {
    setEditando(null);
    setFormOpen(true);
  };

  const abrirEdicao = (canal: CanalDeCaptacao) => {
    setEditando(canal);
    setFormOpen(true);
  };

  const confirmarRotacao = async () => {
    if (!rotacionando?.chave) return;
    try {
      const emitida = await rotacionar.mutateAsync(rotacionando.chave.id);
      const nome = rotacionando.name;
      setRotacionando(null);
      // Diálogo PRÓPRIO, nunca empilhado sobre o de confirmação.
      setChaveNova({ valor: emitida.valor, nome, rotacionada: true });
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Não foi possível rotacionar a chave.'),
      );
    }
  };

  const confirmarExclusao = async () => {
    if (!excluindo) return;
    try {
      await remover.mutateAsync(excluindo.id);
      toast.success('Canal excluído. A chave dele deixou de funcionar.');
      setExcluindo(null);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Não foi possível excluir o canal.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Captação de leads"
        description="Por onde o lead entra no CRM sem ninguém digitar. Cada canal tem a própria chave: revogar um não derruba os outros."
      >
        {/* `cn` obrigatório: sem o merge, o `border-transparent` da base do
            botão vence o `border-border` da variante e o contorno desaparece. */}
        <Link
          to="/ajuda/captacao"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          <BookOpen data-icon="inline-start" />
          Como integrar
        </Link>
        <Button onClick={abrirCriacao}>
          <Plus data-icon="inline-start" />
          Novo canal
        </Button>
      </SectionHeading>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Canal</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Fonte de lead</TableHead>
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
              ) : canais && canais.length > 0 ? (
                canais.map((canal) => (
                  <TableRow key={canal.id}>
                    <TableCell>
                      <span className="font-medium">{canal.name}</span>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {canal.chave?.mascarada ?? 'Sem chave'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canal.assignee ? (
                        canal.assignee.name
                      ) : (
                        <span className="text-muted-foreground">
                          Sem responsável
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canal.source ? (
                        canal.source.name
                      ) : (
                        <span className="text-muted-foreground">
                          Não classifica
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canal.chave?.ultimoUsoEm ? (
                        formatDate(canal.chave.ultimoUsoEm)
                      ) : (
                        <span className="text-muted-foreground">
                          Nunca usada
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => abrirEdicao(canal)}
                        >
                          Editar
                        </Button>
                        {canal.chave && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRotacionando(canal)}
                          >
                            <KeyRound data-icon="inline-start" />
                            Rotacionar chave
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExcluindo(canal)}
                        >
                          Excluir
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={5}>
                  Nenhum canal ainda. Crie um para o seu site entregar lead
                  direto no CRM.
                </TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CanalDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        canal={editando}
        onCriado={({ chave, nome }) =>
          setChaveNova({ valor: chave, nome, rotacionada: false })
        }
      />

      <ConfirmDialog
        open={!!rotacionando}
        onOpenChange={(open) => !open && setRotacionando(null)}
        title="Rotacionar a chave deste canal?"
        description="A chave atual deixa de funcionar imediatamente. Quem estiver enviando lead com ela para de conseguir até você trocar o valor no sistema de origem."
        confirmLabel="Rotacionar"
        pendingLabel="Rotacionando…"
        pending={rotacionar.isPending}
        destructive
        onConfirm={() => void confirmarRotacao()}
      />

      <ConfirmDialog
        open={!!excluindo}
        onOpenChange={(open) => !open && setExcluindo(null)}
        title="Excluir este canal?"
        description={`A chave de ${excluindo?.name ?? 'este canal'} é apagada junto e para de autenticar na hora. Os leads que já entraram por aqui permanecem.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        pending={remover.isPending}
        destructive
        onConfirm={() => void confirmarExclusao()}
      />

      {/* Diálogo próprio: NUNCA empilhado sobre o de confirmação da rotação. */}
      <Dialog
        open={!!chaveNova}
        onOpenChange={(open) => !open && setChaveNova(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {chaveNova?.rotacionada ? 'Chave rotacionada' : 'Canal criado'}
            </DialogTitle>
            <DialogDescription>
              {chaveNova?.rotacionada
                ? `Esta é a chave nova de ${chaveNova.nome}. A anterior já não vale — troque o valor no sistema de origem agora.`
                : `Use esta chave no cabeçalho Authorization: Bearer do seu sistema para entregar lead em ${chaveNova?.nome ?? 'este canal'}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {chaveNova && (
              <CopyBox value={chaveNova.valor} copiedLabel="Chave copiada.">
                Copie agora. Esta é a única vez que a chave aparece — se perder,
                rotacione para gerar outra.
              </CopyBox>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => setChaveNova(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
