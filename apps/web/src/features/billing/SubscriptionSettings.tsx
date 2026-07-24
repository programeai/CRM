import { useState } from 'react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatDate } from '@/lib/format';
import { translateSubscriptionStatus } from '@/lib/labels';
import type { SubscriptionStatus } from './api';
import { openPortal, startCheckout } from './api';
import { useSubscription } from './useSubscription';

const PRICE_LABEL = 'R$ 27,97/mês';

/** Badge com a cor adequada ao status da assinatura. */
function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const variant =
    status === 'ACTIVE' || status === 'TRIALING'
      ? 'default'
      : status === 'PAST_DUE'
        ? 'secondary'
        : 'destructive';
  return <Badge variant={variant}>{translateSubscriptionStatus(status)}</Badge>;
}

/** Cartão de gerenciamento da assinatura (usado na tela de assinatura). */
export default function SubscriptionSettings() {
  const { data, status, daysLeftInTrial, isPending } = useSubscription();
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);

  const run = async (kind: 'checkout' | 'portal') => {
    setBusy(kind);
    try {
      await (kind === 'checkout' ? startCheckout() : openPortal());
      // Em caso de sucesso o navegador é redirecionado ao Stripe.
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível continuar. Tente novamente.';
      toast.error(message);
      setBusy(null);
    }
  };

  const hasSubscription = status === 'ACTIVE' || status === 'PAST_DUE';

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Assinatura</CardTitle>
        <CardDescription>
          Gerencie sua assinatura do CRM ProgrameAi ({PRICE_LABEL}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Carregando…
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              {status ? (
                <StatusBadge status={status} />
              ) : (
                <span className="text-muted-foreground">Sem assinatura</span>
              )}
            </div>

            {status === 'TRIALING' && daysLeftInTrial != null && (
              <p className="text-muted-foreground">
                {daysLeftInTrial > 0
                  ? `Seu período de teste termina em ${daysLeftInTrial} ${
                      daysLeftInTrial === 1 ? 'dia' : 'dias'
                    }.`
                  : 'Seu período de teste terminou.'}
              </p>
            )}

            {hasSubscription && data?.currentPeriodEnd && (
              <p className="text-muted-foreground">
                {data.cancelAtPeriodEnd
                  ? `Sua assinatura será encerrada em ${formatDate(data.currentPeriodEnd)}.`
                  : `Próxima renovação em ${formatDate(data.currentPeriodEnd)}.`}
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        {hasSubscription ? (
          <Button
            onClick={() => run('portal')}
            disabled={busy !== null || isPending}
          >
            {busy === 'portal' && <Spinner data-icon="inline-start" />}
            Gerenciar assinatura
          </Button>
        ) : (
          <Button
            onClick={() => run('checkout')}
            disabled={busy !== null || isPending}
          >
            {busy === 'checkout' && <Spinner data-icon="inline-start" />}
            Assinar
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
