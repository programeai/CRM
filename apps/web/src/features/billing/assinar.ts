import { useState } from 'react';
import { toast } from 'sonner';
import { extractApiMessage } from '@/lib/api-error';
import { openPortal, startCheckout } from './api';
import { useSubscription } from './useSubscription';

/** Preço único da instância hospedada. Um só lugar, usado em todo CTA de assinar. */
export const PRICE_LABEL = 'R$ 27,97/mês';

/**
 * Leva o owner ao Stripe para regularizar a assinatura.
 *
 * `PAST_DUE` é assinatura viva com pagamento recusado: o lugar de resolver é o
 * Customer Portal (trocar o cartão) — abrir um Checkout ali criaria uma segunda
 * assinatura para o mesmo customer. Nos demais casos (teste expirado, cancelada)
 * não existe assinatura para consertar, então é Checkout.
 *
 * Em caso de sucesso o navegador sai da página, por isso `busy` só é desligado
 * no erro.
 */
export function useAssinarAgora() {
  const { status } = useSubscription();
  const [busy, setBusy] = useState(false);

  const assinar = async () => {
    setBusy(true);
    try {
      await (status === 'PAST_DUE' ? openPortal() : startCheckout());
    } catch (erro) {
      toast.error(
        extractApiMessage(
          erro,
          'Não foi possível abrir o pagamento. Tente novamente.',
        ),
      );
      setBusy(false);
    }
  };

  return { assinar, busy };
}
