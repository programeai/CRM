import { Navigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useCan } from '@/hooks/use-can';
import { PRICE_LABEL, useAssinarAgora } from './assinar';
import { useSubscription } from './useSubscription';
import SubscriptionSettings from './SubscriptionSettings';

/**
 * Rota `/assinatura`, alcançada pelo menu ou pelo aviso de assinatura inativa.
 * Quando o billing está desabilitado (autohospedagem), não há o que mostrar →
 * volta ao início. Bloqueado → paywall; com acesso → tela de gerenciamento.
 */
export default function PaywallPage() {
  const { billingEnabled, isBlocked, isPending } = useSubscription();
  const { can } = useCan();
  const { assinar, busy } = useAssinarAgora();

  if (isPending) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  // Autohospedagem (billing off): a feature não existe.
  if (!billingEnabled) return <Navigate to="/" replace />;

  // Colaborador não assina — a assinatura é do dono da conta. Sem esta saída, o
  // 402 o traria para cá e ele veria um botão que só devolveria 403.
  if (!can('assinatura:gerenciar')) {
    return (
      <div className="grid min-h-[70vh] place-items-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-2xl">
              {isBlocked ? 'Assinatura inativa' : 'Assinatura'}
            </CardTitle>
            <CardDescription>
              {isBlocked
                ? 'A conta segue com acesso de consulta e ao cadastro de novos clientes, mas as demais ações estão bloqueadas. Fale com o responsável pela conta para reativar a assinatura.'
                : 'A assinatura é gerenciada pelo responsável pela conta. Você não precisa fazer nada por aqui.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Com acesso: mostra o gerenciamento em vez do paywall.
  if (!isBlocked) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">Assinatura</h1>
        <SubscriptionSettings />
      </div>
    );
  }

  return (
    <div className="grid min-h-[70vh] place-items-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl">Sua assinatura está inativa</CardTitle>
          <CardDescription>
            Seus dados continuam aqui: você segue consultando tudo que já
            cadastrou e registrando novos clientes. Assine para voltar a usar o
            pipeline, as propostas, os projetos e o financeiro.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-primary">R$ 27,97</span>
            <span className="text-muted-foreground">/mês</span>
          </div>
          <Button
            size="lg"
            className="w-full"
            onClick={assinar}
            disabled={busy}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? 'Redirecionando…' : `Assinar por ${PRICE_LABEL}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Pagamento seguro processado pela Stripe. Cancele quando quiser.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
