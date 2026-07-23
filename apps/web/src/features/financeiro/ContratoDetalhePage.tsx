import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, FileX, Pencil, Pause, Play, Ban, Wallet, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { translateBillingType, translateContractStatus, translatePaymentStatus } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useContract, useContractAction, useCancelPayment, useRevertPayment } from './api/hooks';
import { formatMoney, CONTRACT_STATUS_BADGE, PAYMENT_STATUS_BADGE } from './lib/finance-format';
import { isOverdue } from './lib/overdue';
import { ContratoFormDialog } from './ContratoFormDialog';
import { BaixaDialog } from './components/BaixaDialog';
import { CobrancaEditDialog } from './components/CobrancaEditDialog';
import type { Payment } from './api/types';
import { extractApiMessage } from './lib/api-error';

export default function ContratoDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: contract, isLoading, isError } = useContract(id);

  const pause = useContractAction('pause');
  const resume = useContractAction('resume');
  const cancel = useContractAction('cancel');
  const revertPayment = useRevertPayment();
  const cancelPayment = useCancelPayment();

  const [editOpen, setEditOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const [baixaTarget, setBaixaTarget] = useState<Payment | null>(null);
  const [editTarget, setEditTarget] = useState<Payment | null>(null);
  const [revertTarget, setRevertTarget] = useState<Payment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Payment | null>(null);

  const confirmPause = async () => {
    try {
      await pause.mutateAsync(id);
      toast.success('Contrato pausado.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao pausar o contrato.'));
    } finally {
      setPauseOpen(false);
    }
  };
  const confirmResume = async () => {
    try {
      await resume.mutateAsync(id);
      toast.success('Contrato retomado.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao retomar o contrato.'));
    } finally {
      setResumeOpen(false);
    }
  };
  const confirmCancel = async () => {
    try {
      await cancel.mutateAsync(id);
      toast.success('Contrato cancelado.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao cancelar o contrato.'));
    } finally {
      setCancelOpen(false);
    }
  };
  const confirmRevert = async () => {
    if (!revertTarget) return;
    try {
      await revertPayment.mutateAsync(revertTarget.id);
      toast.success('Cobrança estornada.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao estornar a cobrança.'));
    } finally {
      setRevertTarget(null);
    }
  };
  const confirmCancelPayment = async () => {
    if (!cancelTarget) return;
    try {
      await cancelPayment.mutateAsync(cancelTarget.id);
      toast.success('Cobrança cancelada.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao cancelar a cobrança.'));
    } finally {
      setCancelTarget(null);
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

  if (isError || !contract) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileX />
          </EmptyMedia>
          <EmptyTitle>Contrato não encontrado.</EmptyTitle>
          <EmptyDescription>
            <Button variant="link" onClick={() => navigate('/financeiro/contratos')}>
              Voltar para contratos
            </Button>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const isActive = contract.status === 'ACTIVE';
  const isPaused = contract.status === 'PAUSED';
  const readOnly = contract.status === 'CANCELED' || contract.status === 'FINISHED';

  const recebido = contract.payments
    .filter((p) => p.status === 'PAID')
    .reduce((sum, p) => sum + Number(p.paidAmount ?? p.amount), 0);
  const aReceber = contract.payments
    .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const emAtraso = contract.payments
    .filter((p) => p.status === 'OVERDUE')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const oneTimePayment = contract.billingType === 'ONE_TIME' ? contract.payments[0] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-0 text-muted-foreground"
          onClick={() => navigate('/financeiro/contratos')}
        >
          <ArrowLeft data-icon="inline-start" />
          Contratos
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold">{contract.description}</h1>
              <Badge variant={CONTRACT_STATUS_BADGE[contract.status]}>
                {translateContractStatus(contract.status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{contract.client.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil data-icon="inline-start" />
                Editar
              </Button>
            )}
            {isActive && (
              <Button variant="outline" onClick={() => setPauseOpen(true)}>
                <Pause data-icon="inline-start" />
                Pausar
              </Button>
            )}
            {isPaused && (
              <Button variant="outline" onClick={() => setResumeOpen(true)}>
                <Play data-icon="inline-start" />
                Retomar
              </Button>
            )}
            {!readOnly && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban data-icon="inline-start" />
                Cancelar
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Regime</span>
          <span className="text-sm">{translateBillingType(contract.billingType)}</span>
        </div>

        {contract.billingType === 'RECURRING' && (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Valor mensal</span>
              <span className="text-sm">{formatMoney(contract.monthlyAmount)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Dia de vencimento</span>
              <span className="text-sm">{contract.billingDay ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Início</span>
              <span className="text-sm">{formatDate(contract.startDate) || '—'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Término</span>
              <span className="text-sm">{formatDate(contract.endDate) || '—'}</span>
            </div>
          </>
        )}

        {contract.billingType === 'INSTALLMENTS' && (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Entrada</span>
              <span className="text-sm">{formatMoney(contract.downPayment)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Nº de parcelas</span>
              <span className="text-sm">{contract.installments ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Valor da parcela</span>
              <span className="text-sm">{formatMoney(contract.installmentAmount)}</span>
            </div>
          </>
        )}

        {contract.billingType === 'ONE_TIME' && oneTimePayment && (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Valor</span>
              <span className="text-sm">{formatMoney(oneTimePayment.amount)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Vencimento</span>
              <span className="text-sm">{formatDate(oneTimePayment.dueDate) || '—'}</span>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">Recebido</span>
          <span className="text-lg font-semibold">{formatMoney(recebido)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">A receber</span>
          <span className="text-lg font-semibold">{formatMoney(aReceber)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">Em atraso</span>
          <span className="text-lg font-semibold text-destructive">{formatMoney(emAtraso)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-sm font-medium">Cobranças</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contract.payments.length > 0 ? (
                contract.payments.map((payment) => {
                  const overdue = payment.status === 'OVERDUE' || isOverdue(payment);
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>{payment.description}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={overdue ? 'text-destructive' : undefined}>
                            {formatDate(payment.dueDate) || '—'}
                          </span>
                          {overdue && <Badge variant="destructive">Vencida</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{formatMoney(payment.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={PAYMENT_STATUS_BADGE[payment.status]}>
                          {translatePaymentStatus(payment.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {(payment.status === 'PENDING' || payment.status === 'OVERDUE') && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setBaixaTarget(payment)}>
                                <Wallet data-icon="inline-start" />
                                Dar baixa
                              </Button>
                              {payment.status === 'PENDING' && (
                                <Button size="sm" variant="ghost" onClick={() => setEditTarget(payment)}>
                                  <Pencil data-icon="inline-start" />
                                  Editar
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => setCancelTarget(payment)}
                              >
                                <Ban data-icon="inline-start" />
                                Cancelar
                              </Button>
                            </>
                          )}
                          {payment.status === 'PAID' && (
                            <Button size="sm" variant="ghost" onClick={() => setRevertTarget(payment)}>
                              <Undo2 data-icon="inline-start" />
                              Estornar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableEmpty colSpan={5}>Nenhuma cobrança gerada.</TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ContratoFormDialog open={editOpen} onOpenChange={setEditOpen} contract={contract} />

      <ConfirmDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title="Pausar contrato"
        description="Tem certeza que deseja pausar este contrato? Nenhuma mensalidade nova será gerada enquanto pausado."
        confirmLabel="Pausar"
        pendingLabel="Pausando…"
        pending={pause.isPending}
        onConfirm={() => void confirmPause()}
      />
      <ConfirmDialog
        open={resumeOpen}
        onOpenChange={setResumeOpen}
        title="Retomar contrato"
        description="Tem certeza que deseja retomar este contrato?"
        confirmLabel="Retomar"
        pendingLabel="Retomando…"
        pending={resume.isPending}
        onConfirm={() => void confirmResume()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancelar contrato"
        description="Tem certeza que deseja cancelar este contrato? As cobranças pendentes e vencidas serão canceladas; as já pagas permanecem no histórico."
        confirmLabel="Cancelar contrato"
        pendingLabel="Cancelando…"
        destructive
        pending={cancel.isPending}
        onConfirm={() => void confirmCancel()}
      />
      <ConfirmDialog
        open={!!revertTarget}
        onOpenChange={(open) => !open && setRevertTarget(null)}
        title="Estornar cobrança"
        description="Tem certeza que deseja estornar esta cobrança? Ela volta a Pendente e o pagamento é registrado nas observações."
        confirmLabel="Estornar"
        pendingLabel="Estornando…"
        pending={revertPayment.isPending}
        onConfirm={() => void confirmRevert()}
      />
      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancelar cobrança"
        description="Tem certeza que deseja cancelar esta cobrança?"
        confirmLabel="Cancelar cobrança"
        pendingLabel="Cancelando…"
        destructive
        pending={cancelPayment.isPending}
        onConfirm={() => void confirmCancelPayment()}
      />

      {baixaTarget && (
        <BaixaDialog
          open
          onOpenChange={(open) => !open && setBaixaTarget(null)}
          payment={baixaTarget}
        />
      )}
      {editTarget && (
        <CobrancaEditDialog
          open
          onOpenChange={(open) => !open && setEditTarget(null)}
          payment={editTarget}
        />
      )}
    </div>
  );
}
