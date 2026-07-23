import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, FileX, Pencil, Send, ThumbsDown, ThumbsUp, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TableLink } from '@/components/ui/table-link';
import { translateProposalStatus, translateServiceType } from '@/lib/labels';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  useDeleteProposal,
  useProposal,
  useProposalAction,
  useProposalVersions,
} from './api/hooks';
import { formatMoney } from './lib/proposal-format';
import { ProposalFormDialog } from './ProposalFormDialog';
import type { ProposalStatus } from './api/types';
import { extractApiMessage } from './lib/api-error';

const STATUS_BADGE: Record<ProposalStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'outline',
  NEGOTIATING: 'outline',
  ACCEPTED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
};

export default function PropostaDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: proposal, isLoading, isError } = useProposal(id);
  const { data: versions } = useProposalVersions(id);

  const send = useProposalAction('send');
  const accept = useProposalAction('accept');
  const reject = useProposalAction('reject');
  const newVersion = useProposalAction('newVersion');
  const deleteProposal = useDeleteProposal();

  const [editOpen, setEditOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleSend = async () => {
    try {
      await send.mutateAsync(id);
      toast.success('Proposta enviada.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao enviar a proposta.'));
    }
  };

  const confirmAccept = async () => {
    try {
      await accept.mutateAsync(id);
      toast.success('Proposta aceita.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao aceitar a proposta.'));
    } finally {
      setAcceptOpen(false);
    }
  };

  const confirmReject = async () => {
    try {
      await reject.mutateAsync(id);
      toast.success('Proposta recusada.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao recusar a proposta.'));
    } finally {
      setRejectOpen(false);
    }
  };

  const handleNewVersion = async () => {
    try {
      const created = await newVersion.mutateAsync(id);
      toast.success('Nova versão criada.');
      navigate(`/propostas/${created.id}`);
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao criar nova versão.'));
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteProposal.mutateAsync(id);
      toast.success('Proposta excluída.');
      navigate('/propostas');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao excluir a proposta.'));
    } finally {
      setDeleteOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !proposal) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileX />
          </EmptyMedia>
          <EmptyTitle>Proposta não encontrada.</EmptyTitle>
          <EmptyDescription>
            <Button variant="link" onClick={() => navigate('/propostas')}>
              Voltar para propostas
            </Button>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const isDraft = proposal.status === 'DRAFT';
  const canDecide = proposal.status === 'SENT' || proposal.status === 'NEGOTIATING';
  const isFinal = proposal.status === 'ACCEPTED' || proposal.status === 'REJECTED' || proposal.status === 'EXPIRED';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-0 text-muted-foreground"
          onClick={() => navigate('/propostas')}
        >
          <ArrowLeft data-icon="inline-start" />
          Propostas
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold">
                {proposal.number} · v{proposal.version}
              </h1>
              <Badge variant={STATUS_BADGE[proposal.status]}>
                {translateProposalStatus(proposal.status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{proposal.client.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && (
              <>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil data-icon="inline-start" />
                  Editar
                </Button>
                <Button onClick={() => void handleSend()} disabled={send.isPending}>
                  <Send data-icon="inline-start" />
                  Enviar
                </Button>
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 data-icon="inline-start" />
                  Excluir
                </Button>
              </>
            )}
            {canDecide && (
              <>
                <Button onClick={() => setAcceptOpen(true)}>
                  <ThumbsUp data-icon="inline-start" />
                  Aceitar
                </Button>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  <ThumbsDown data-icon="inline-start" />
                  Recusar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleNewVersion()}
                  disabled={newVersion.isPending}
                >
                  <Copy data-icon="inline-start" />
                  Nova versão
                </Button>
              </>
            )}
            {isFinal && (
              <Button
                variant="outline"
                onClick={() => void handleNewVersion()}
                disabled={newVersion.isPending}
              >
                <Copy data-icon="inline-start" />
                Nova versão
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Tipo de serviço</span>
          <span className="text-sm">{translateServiceType(proposal.serviceType)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Válida até</span>
          <span className="text-sm">{formatDate(proposal.validUntil) || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Condições de pagamento</span>
          <span className="text-sm">{proposal.paymentTerms || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Prazo de entrega</span>
          <span className="text-sm">{proposal.deliveryTime || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Enviada em</span>
          <span className="text-sm">{formatDateTime(proposal.sentAt) || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Decidida em</span>
          <span className="text-sm">{formatDateTime(proposal.decidedAt) || '—'}</span>
        </div>
        {proposal.scope && (
          <div className="flex flex-col gap-0.5 sm:col-span-2 lg:col-span-4">
            <span className="text-xs text-muted-foreground">Escopo</span>
            <p className="whitespace-pre-wrap text-sm">{proposal.scope}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-sm font-medium">Itens</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Qtd.</TableHead>
                <TableHead>Valor unitário</TableHead>
                <TableHead>Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposal.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{Number(item.quantity)}</TableCell>
                  <TableCell>{formatMoney(item.unitPrice)}</TableCell>
                  <TableCell>{formatMoney(Number(item.quantity) * Number(item.unitPrice))}</TableCell>
                </TableRow>
              ))}
              {proposal.discount && Number(proposal.discount) > 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-muted-foreground">
                    Desconto
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    − {formatMoney(proposal.discount)}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">
                  Total
                </TableCell>
                <TableCell className="font-semibold">{formatMoney(proposal.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-sm font-medium">Versões</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions && versions.length > 0 ? (
                versions.map((v) => (
                  <TableRow key={v.id} className={v.id === proposal.id ? 'bg-muted/50' : undefined}>
                    <TableCell>
                      {v.id === proposal.id ? (
                        <span className="font-medium">v{v.version} (atual)</span>
                      ) : (
                        <TableLink to={`/propostas/${v.id}`}>v{v.version}</TableLink>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[v.status]}>{translateProposalStatus(v.status)}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(v.createdAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={3}>Nenhuma versão anterior.</TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ProposalFormDialog open={editOpen} onOpenChange={setEditOpen} proposal={proposal} />

      <ConfirmDialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        title="Aceitar proposta"
        description="Tem certeza que deseja aceitar esta proposta? Se houver oportunidade vinculada, ela será movida para o estágio “Ganhou”."
        confirmLabel="Aceitar"
        pendingLabel="Aceitando…"
        pending={accept.isPending}
        onConfirm={() => void confirmAccept()}
      />
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Recusar proposta"
        description="Tem certeza que deseja recusar esta proposta?"
        confirmLabel="Recusar"
        pendingLabel="Recusando…"
        destructive
        pending={reject.isPending}
        onConfirm={() => void confirmReject()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir proposta"
        description={`Tem certeza que deseja excluir o rascunho “${proposal.number}”? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        pending={deleteProposal.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
