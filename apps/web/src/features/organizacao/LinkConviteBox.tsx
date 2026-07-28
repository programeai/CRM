import { CopyBox } from '@/components/ui/copy-box';

/**
 * Caixa com o link do convite e botão de copiar. O link também vai por e-mail;
 * exibi-lo aqui é o que mantém o fluxo utilizável quando o SMTP não está
 * configurado ou o e-mail não chega.
 */
export function LinkConviteBox({
  url,
  expiresInDays,
}: {
  url: string;
  expiresInDays: number;
}) {
  return (
    <CopyBox value={url} copiedLabel="Link copiado.">
      O link vale por {expiresInDays} dias e só pode ser usado uma vez. Gerar um
      novo convite invalida este.
    </CopyBox>
  );
}
