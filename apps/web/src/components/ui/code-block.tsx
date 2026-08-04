import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  /** O trecho exibido em `font-mono`, com as quebras de linha preservadas. */
  code: string;
  /** Rótulo do canto superior ("Requisição", "Resposta", "Corpo enviado"). */
  label?: string;
  /** Rótulo do toast de sucesso. */
  copiedLabel?: string;
  className?: string;
}

/**
 * Bloco de código de várias linhas com botão de copiar. Irmão do `CopyBox`, e
 * separado dele de propósito: o `CopyBox` mostra **um valor** (um segredo de
 * exibição única, em uma linha que quebra), este mostra **um trecho** — payload
 * JSON, comando `curl` — onde a indentação é parte da informação e a linha
 * longa precisa rolar na horizontal em vez de embrulhar.
 *
 * Sem realce de sintaxe: não há dependência de highlight no projeto, e um
 * payload de treze campos se lê bem sem ela.
 */
export function CodeBlock({
  code,
  label,
  copiedLabel = 'Copiado.',
  className,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(copiedLabel);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie à mão.');
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-muted/40', className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          {label ?? 'Exemplo'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
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
      <div className="overflow-x-auto">
        <pre className="p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {code}
        </pre>
      </div>
    </div>
  );
}
