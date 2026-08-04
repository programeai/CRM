import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PainelDeConsentimento } from './PainelDeConsentimento';

interface Props {
  /** O contato em exibição; `null` fecha. */
  contato: { id: string; name: string } | null;
  onFechar: () => void;
}

/**
 * O livro-razão de **um contato**, num diálogo.
 *
 * Diálogo, e não aba própria: contato não tem tela de detalhe no CRM — ele vive na
 * lista dentro da ficha do cliente. Uma aba exigiria criar essa tela, e o
 * consentimento não é motivo suficiente para inventar uma navegação nova.
 *
 * Reusa o `PainelDeConsentimento` inteiro: a única diferença em relação ao do
 * cliente é o par `subjectType`/`subjectId`.
 */
export function ConsentimentoDoContatoDialog({ contato, onFechar }: Props) {
  return (
    <Dialog open={!!contato} onOpenChange={(open) => !open && onFechar()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Consentimento de {contato?.name}</DialogTitle>
          <DialogDescription>
            O consentimento do contato é separado do consentimento do cliente: são
            titulares diferentes, e cada pessoa autoriza por si.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {contato && (
            <PainelDeConsentimento
              subjectType="CONTACT"
              subjectId={contato.id}
              titular={contato.name}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
