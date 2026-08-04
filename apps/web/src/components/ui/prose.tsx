import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * Tipografia de texto corrido. O projeto não usa o plugin `typography` do
 * Tailwind, então toda página de leitura — os documentos legais e as páginas de
 * ajuda — é composta por estes blocos, em cima dos tokens do design system e
 * sem nada hard-coded.
 *
 * Vive no design system porque tem dois consumidores em features distintas
 * (`features/legal` e `features/ajuda`).
 */

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[0.9375rem] leading-relaxed text-muted-foreground', className)}>
      {children}
    </p>
  );
}

/**
 * Subtítulo dentro de uma seção. `nivel` acompanha o cabeçalho da seção que o
 * contém — `h3` sob um `h2` (documentos legais), `h4` sob um `h3` (páginas de
 * ajuda, onde o `h1` é da tela) — para o leitor de tela não ver dois níveis
 * iguais aninhados.
 */
export function Sub({
  children,
  nivel = 3,
}: {
  children: ReactNode;
  nivel?: 3 | 4;
}) {
  const Tag = nivel === 4 ? 'h4' : 'h3';
  return (
    <Tag className="mt-2 text-sm font-semibold tracking-[-0.01em] text-foreground">
      {children}
    </Tag>
  );
}

export function Lista({ children, ordenada = false }: { children: ReactNode; ordenada?: boolean }) {
  const classes =
    'space-y-2 pl-5 text-[0.9375rem] leading-relaxed text-muted-foreground marker:text-primary';
  return ordenada ? (
    <ol className={cn(classes, 'list-decimal')}>{children}</ol>
  ) : (
    <ul className={cn(classes, 'list-disc')}>{children}</ul>
  );
}

export function Item({ children }: { children: ReactNode }) {
  return <li className="pl-1">{children}</li>;
}

/** Termo em destaque no meio do texto corrido. */
export function Forte({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

/**
 * Nome de campo, cabeçalho ou valor literal no meio da frase. Para bloco de
 * código de várias linhas, use o `CodeBlock`.
 */
export function Codigo({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground">
      {children}
    </code>
  );
}

/** Caixa de destaque para pontos que o usuário não deve deixar passar. */
export function Destaque({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-2 border-l-primary bg-muted/60 px-4 py-3">
      <div className="space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function Email({ endereco }: { endereco: string }) {
  return (
    <a href={`mailto:${endereco}`} className="font-medium text-primary hover:underline">
      {endereco}
    </a>
  );
}

export function Externo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-primary hover:underline"
    >
      {children}
    </a>
  );
}

export function Interno({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}

/** Par rótulo/valor do bloco de identificação do controlador. */
export function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="shrink-0 text-[0.8125rem] font-medium text-foreground">{rotulo}</span>
      <span className="text-[0.8125rem] text-muted-foreground">{children}</span>
    </div>
  );
}
