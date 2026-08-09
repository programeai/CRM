import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCan } from '@/hooks/use-can';
import { PRICE_LABEL, useAssinarAgora } from './assinar';
import { useSubscription } from './useSubscription';

/**
 * Aviso fixo de assinatura inativa, montado pelo `AppLayout` acima do conteúdo —
 * então aparece já no painel, que é onde a pessoa cai ao entrar.
 *
 * O backend é a autoridade: sem assinatura ativa ele responde `402` em tudo que
 * escreve, menos cadastrar cliente. Aqui só explicamos o que sobrou e damos o
 * caminho para o Stripe. Colaborador vê a explicação sem botão — a assinatura é
 * do dono da conta e o `POST /billing/checkout` devolveria `403` para ele.
 */
export default function SubscriptionBlockedNotice() {
  const { isBlocked } = useSubscription();
  const { can } = useCan();
  const { assinar, busy } = useAssinarAgora();

  if (!isBlocked) return null;

  const podeAssinar = can('assinatura:gerenciar');

  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium text-destructive">
              Sua assinatura está inativa.
            </p>
            <p className="text-muted-foreground">
              {podeAssinar
                ? 'Você continua consultando tudo que já cadastrou e registrando novos clientes. As demais ações ficam bloqueadas até a assinatura ser reativada.'
                : 'A conta continua com acesso de consulta e ao cadastro de novos clientes. Fale com o responsável pela conta para reativar a assinatura.'}
            </p>
          </div>
        </div>
        {podeAssinar && (
          <Button
            onClick={assinar}
            disabled={busy}
            className="shrink-0 self-start sm:self-auto"
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? 'Redirecionando…' : `Assinar por ${PRICE_LABEL}`}
          </Button>
        )}
      </div>
    </div>
  );
}
