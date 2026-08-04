import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

interface Props {
  /** Presente = exibindo. `null` fecha. */
  codigos: string[] | null;
  onFechar: () => void;
  /** Regeneração avisa que os antigos morreram; ativação, não. */
  regenerado?: boolean;
}

/**
 * Os 16 códigos de recuperação, exibidos **uma única vez**. Nunca empilhado sobre
 * outro diálogo: quem o abre fecha o de confirmação primeiro (regra dos modais).
 *
 * O botão de baixar existe porque é o comportamento que o GitHub tem e que a
 * pessoa espera — e porque copiar 16 linhas para um lugar seguro é justamente o
 * passo que ninguém faz se der trabalho.
 */
export function CodigosDeRecuperacaoDialog({
  codigos,
  onFechar,
  regenerado = false,
}: Props) {
  const texto = (codigos ?? []).join('\n');

  const baixar = () => {
    const blob = new Blob(
      [
        `Códigos de recuperação — ProgrameAi CRM\n`,
        `Cada código serve UMA vez. Guarde este arquivo em lugar seguro.\n\n`,
        `${texto}\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codigos-de-recuperacao-crm.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={!!codigos} onOpenChange={(open) => !open && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {regenerado
              ? 'Códigos de recuperação novos'
              : 'Guarde os códigos de recuperação'}
          </DialogTitle>
          <DialogDescription>
            {regenerado
              ? 'Os códigos anteriores deixaram de valer. Guarde estes no lugar dos antigos.'
              : 'Cada código serve uma única vez e substitui o app autenticador se você perder o celular. Sem eles e sem o app, ninguém recupera o acesso.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {codigos && (
            <CopyBox value={texto} copiedLabel="Códigos copiados.">
              Esta é a única vez que os códigos aparecem. Copie ou baixe agora —
              se perder, gere outros nesta tela.
            </CopyBox>
          )}
          <Button type="button" variant="outline" onClick={baixar}>
            <Download data-icon="inline-start" />
            Baixar em .txt
          </Button>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onFechar}>
            Guardei os códigos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
