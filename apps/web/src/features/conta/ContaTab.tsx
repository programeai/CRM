import { useState } from 'react';
import { Navigate } from 'react-router';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ConfirmTypedDialog } from '@/components/ui/confirm-typed-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { formatDate } from '@/lib/format';
import { extractApiMessage } from '@/lib/api-error';
import { useCan } from '@/hooks/use-can';
import { useDownload } from '@/hooks/use-download';
import { useMe } from '@/features/perfil/api/hooks';
import {
  useCancelarEncerramento,
  useSolicitarEncerramento,
} from './api/hooks';

/**
 * Aba "Conta" de `/configuracoes`: os direitos do titular sobre a workspace.
 * Exclusiva do dono — a aba já é filtrada em `ConfiguracoesLayout`, e este
 * redirect é o que impede a URL direta de renderizar uma tela que a API recusa.
 */
export default function ContaTab() {
  const { isOwner, loading } = useCan();
  const { baixar, baixando } = useDownload();
  const { data: me } = useMe();

  const [encerrarAberto, setEncerrarAberto] = useState(false);
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const solicitar = useSolicitarEncerramento();
  const cancelar = useCancelarEncerramento();

  if (loading) return <Skeleton className="h-40 w-full max-w-lg" />;
  if (!isOwner) return <Navigate to="/configuracoes" replace />;

  const dia = new Date().toISOString().slice(0, 10);
  const agendamento = me?.deletion ?? null;

  function confirmarEncerramento(senha?: string) {
    solicitar.mutate(
      me?.hasPassword ? { password: senha } : { email: me?.email },
      {
        onSuccess: (resposta) => {
          setEncerrarAberto(false);
          toast.success(
            `Encerramento agendado para ${formatDate(resposta.scheduledFor)}.`,
          );
        },
        onError: (erro) => {
          toast.error(
            extractApiMessage(erro, 'Não foi possível agendar o encerramento.'),
          );
        },
      },
    );
  }

  function confirmarCancelamento() {
    cancelar.mutate(undefined, {
      onSuccess: () => {
        setCancelarAberto(false);
        toast.success('Encerramento cancelado. Sua conta segue ativa.');
      },
      onError: (erro) => {
        toast.error(
          extractApiMessage(erro, 'Não foi possível cancelar o encerramento.'),
        );
      },
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">Meus dados</h2>
          <p className="text-sm text-muted-foreground">
            Baixe tudo que existe nesta conta num arquivo único: clientes,
            contatos, oportunidades, propostas, projetos, demandas, contratos,
            cobranças, atividades, catálogos e a equipe. O formato é JSON, legível
            por máquina, para você levar os dados para onde quiser.
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={baixando}
            onClick={() =>
              void baixar('/account/export', `meus-dados-${dia}.json`)
            }
          >
            {baixando ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {baixando ? 'Preparando…' : 'Baixar meus dados'}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-destructive/40 p-4">
        {agendamento ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-lg font-semibold">
                Encerramento agendado
              </h2>
              <p className="text-sm text-muted-foreground">
                Sua conta será encerrada em{' '}
                <strong className="font-medium text-foreground">
                  {formatDate(agendamento.scheduledFor)}
                </strong>
                . Até lá, o CRM continua funcionando normalmente e você pode
                desistir a qualquer momento.
              </p>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelarAberto(true)}
              >
                Cancelar o encerramento
              </Button>
            </div>
            <ConfirmDialog
              open={cancelarAberto}
              onOpenChange={setCancelarAberto}
              title="Cancelar o encerramento?"
              description="Os dois campos de agendamento voltam a vazio e a conta segue normalmente, sem qualquer perda de dado."
              confirmLabel="Cancelar o encerramento"
              pendingLabel="Cancelando…"
              pending={cancelar.isPending}
              onConfirm={confirmarCancelamento}
            />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-lg font-semibold">
                Encerrar minha conta
              </h2>
              <p className="text-sm text-muted-foreground">
                Encerra a conta e toda a workspace: clientes, propostas,
                projetos, contratos, cobranças, catálogos e a equipe. A
                assinatura é cancelada e ninguém mais acessa o CRM. O pedido
                fica 30 dias em carência, cancelável a qualquer momento — passado
                o prazo, a exclusão é definitiva e não há recuperação. Exporte
                seus dados antes de confirmar.
              </p>
            </div>
            <div>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setEncerrarAberto(true)}
              >
                Encerrar minha conta
              </Button>
            </div>
            <ConfirmTypedDialog
              open={encerrarAberto}
              onOpenChange={setEncerrarAberto}
              title="Encerrar a conta em definitivo?"
              description="Esta ação agenda o encerramento com 30 dias de carência. Passado o prazo, a workspace inteira é apagada e a recuperação deixa de ser possível."
              expected={me?.email ?? ''}
              expectedLabel="o e-mail da conta"
              secret={me?.hasPassword ?? false}
              secretLabel="Sua senha"
              confirmLabel="Encerrar minha conta"
              pendingLabel="Agendando…"
              pending={solicitar.isPending}
              onConfirm={confirmarEncerramento}
            />
          </>
        )}
      </section>
    </div>
  );
}
