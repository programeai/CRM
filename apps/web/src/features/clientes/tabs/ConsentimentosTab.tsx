import { useOutletContext } from 'react-router';
import { PainelDeConsentimento } from '@/features/consentimento/PainelDeConsentimento';
import type { Client } from '../api/types';

/**
 * Aba "Consentimento" da ficha do cliente. O painel em si vive em
 * `features/consentimento` porque serve `Client` **e** `Contact` — uma feature não
 * importa o interior de outra, e duplicar a tela nos dois lugares duplicaria a
 * regra.
 */
export default function ConsentimentosTab() {
  const client = useOutletContext<Client>();
  return (
    <PainelDeConsentimento
      subjectType="CLIENT"
      subjectId={client.id}
      titular={client.name}
    />
  );
}
