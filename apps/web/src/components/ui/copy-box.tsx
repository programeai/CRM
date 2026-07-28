import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface Props {
  /** O valor exibido em `font-mono` e copiado para a área de transferência. */
  value: string;
  /** Aviso sob a caixa — o texto é de quem usa, não do primitivo. */
  children?: ReactNode;
  /** Rótulo do toast de sucesso ("Link copiado.", "Chave copiada."). */
  copiedLabel?: string;
}

/**
 * Caixa com um valor para copiar. Vive no design system porque tem dois
 * consumidores: o link do convite de colaborador e a chave de integração do
 * canal de captação — os dois segredos de exibição única do produto.
 *
 * O valor fica **visível** de propósito: navegador sem permissão de clipboard
 * (ou fora de contexto seguro) ainda permite selecionar e copiar à mão, e o
 * `toast.error` diz isso em vez de falhar calado.
 */
export function CopyBox({ value, children, copiedLabel = 'Copiado.' }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(copiedLabel);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        'Não foi possível copiar. Selecione o texto e copie à mão.',
      );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">
          {value}
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
      {children && <p className="text-xs text-muted-foreground">{children}</p>}
    </div>
  );
}
