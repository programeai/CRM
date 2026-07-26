import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

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
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copiado.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Navegador sem permissão de clipboard (ou contexto não seguro): o link
      // está visível no campo, então dá para selecionar e copiar à mão.
      toast.error('Não foi possível copiar. Selecione o link e copie à mão.');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        O link vale por {expiresInDays} dias e só pode ser usado uma vez. Gerar
        um novo convite invalida este.
      </p>
    </div>
  );
}
