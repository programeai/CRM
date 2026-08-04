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
import { ChaveDialog } from './ChaveDialog';
import { useChavesDeApi, useEscopos, useRevogarChave, useRotacionarChave } from './api/hooks';
import type { ChaveDeIntegracao } from './api/types';

/** A chave recém-gerada, exibida uma única vez. */
interface ChaveNova {
  valor: string;
  nome: string;
  /** Rotação avisa que a anterior morreu; criação, não. */
  rotacionada: boolean;
}

export default function ApiPage() {
  const { data: chaves, isLoading } = useChavesDeApi();
  const { data: escopos } = useEscopos();
  const rotacionar = useRotacionarChave();
  const revogar = useRevogarChave();

  const [formOpen, setFormOpen] = useState(false);
  const [rotacionando, setRotacionando] = useState<ChaveDeIntegracao | null>(
    null,
  );
  const [revogando, setRevogando] = useState<ChaveDeIntegracao | null>(null);
  const [chaveNova, setChaveNova] = useState<ChaveNova | null>(null);

  // Rótulo em pt-BR de cada escopo — o front nunca duplica esse texto.
  const rotuloPorEscopo = new Map(
    (escopos ?? []).map((e) => [e.key, e.label] as const),
  );

  const confirmarRotacao = async () => {
    if (!rotacionando) return;
    try {
      const emitida = await rotacionar.mutateAsync(rotacionando.id);
      const nome = rotacionando.nome;
      setRotacionando(null);
      // Diálogo PRÓPRIO, nunca empilhado sobre o de confirmação.
      setChaveNova({ valor: emitida.valor, nome, rotacionada: true });
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Não foi possível rotacionar a chave.'),
      );
    }
  };

  const confirmarRevogacao = async () => {
    if (!revogando) return;
    try {
      await revogar.mutateAsync(revogando.id);
      toast.success('Chave revogada. Ela deixou de autenticar.');
      setRevogando(null);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Não foi possível revogar a chave.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Chaves de API"
        description="Credenciais para um sistema externo escrever no pipeline da sua workspace, com escopo por entidade."
      >
        <Link
          to="/ajuda/api"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          <BookOpen data-icon="inline-start" />
          Como integrar
        </Link>
        <Button onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Nova chave
        </Button>
      </SectionHeading>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Escopos</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead>Estado</TableHead>
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
              ) : chaves && chaves.length > 0 ? (
                chaves.map((chave) => (
                  <TableRow key={chave.id}>
                    <TableCell>
                      <span className="font-medium">{chave.nome}</span>
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {chave.mascarada}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {chave.escopos.map((key) => (
                          <Badge key={key} variant="secondary">
                            {rotuloPorEscopo.get(key) ?? key}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {chave.ultimoUsoEm ? (
                        formatDate(chave.ultimoUsoEm)
                      ) : (
                        <span className="text-muted-foreground">
                          Nunca usada
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {chave.revogadaEm ? (
                        <Badge variant="destructive">Revogada</Badge>
                      ) : (
                        <Badge>Ativa</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRotacionando(chave)}
                        >
                          <KeyRound data-icon="inline-start" />
                          Rotacionar
                        </Button>
                        {!chave.revogadaEm && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRevogando(chave)}
                          >
                            Revogar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={5}>
                  Nenhuma chave de API ainda. Crie uma para um sistema externo
                  escrever no seu pipeline.
                </TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ChaveDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCriado={({ valor, nome }) =>
          setChaveNova({ valor, nome, rotacionada: false })
        }
      />

      <ConfirmDialog
        open={!!rotacionando}
        onOpenChange={(open) => !open && setRotacionando(null)}
        title="Rotacionar esta chave?"
        description="A chave atual deixa de funcionar imediatamente. Quem estiver usando o valor anterior para de conseguir até você trocá-lo no sistema de origem."
        confirmLabel="Rotacionar"
        pendingLabel="Rotacionando…"
        pending={rotacionar.isPending}
        destructive
        onConfirm={() => void confirmarRotacao()}
      />

      <ConfirmDialog
        open={!!revogando}
        onOpenChange={(open) => !open && setRevogando(null)}
        title="Revogar esta chave?"
        description={`${revogando?.nome ?? 'Esta chave'} deixa de autenticar imediatamente. A linha continua na tabela, marcada como revogada — você pode rotacioná-la depois para reativar.`}
        confirmLabel="Revogar"
        pendingLabel="Revogando…"
        pending={revogar.isPending}
        destructive
        onConfirm={() => void confirmarRevogacao()}
      />

      {/* Diálogo próprio: NUNCA empilhado sobre o de confirmação. */}
      <Dialog
        open={!!chaveNova}
        onOpenChange={(open) => !open && setChaveNova(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {chaveNova?.rotacionada ? 'Chave rotacionada' : 'Chave criada'}
            </DialogTitle>
            <DialogDescription>
              {chaveNova?.rotacionada
                ? `Esta é a chave nova de ${chaveNova.nome}. A anterior já não vale — troque o valor no sistema de origem agora.`
                : `Use esta chave no cabeçalho Authorization: Bearer do seu sistema para escrever na sua workspace.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {chaveNova && (
              <CopyBox value={chaveNova.valor} copiedLabel="Chave copiada.">
                Copie agora. Esta é a única vez que a chave aparece — se
                perder, rotacione para gerar outra.
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
