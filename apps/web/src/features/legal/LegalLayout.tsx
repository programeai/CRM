import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { BrandLockup } from '@/components/ui/brand-lockup';
import { ATUALIZADO_EM, EMPRESA } from '@/lib/company';

export type Secao = {
  /** Âncora da seção (`#id`), usada pelo índice. */
  id: string;
  titulo: string;
  corpo: ReactNode;
};

type Props = {
  title: string;
  /** Uma linha explicando o que o documento cobre. */
  description: string;
  /** Resumo em linguagem simples, antes do texto formal. */
  resumo: ReactNode;
  secoes: Secao[];
  /** Link para o outro documento legal, no rodapé. */
  outroDocumento: { to: string; label: string };
};

/** Índice das seções. Renderizado duas vezes (topo no mobile, coluna fixa no xl). */
function Indice({ secoes, className }: { secoes: Secao[]; className?: string }) {
  return (
    <nav aria-label="Índice do documento" className={className}>
      <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        Neste documento
      </p>
      <ol className="space-y-1.5">
        {secoes.map((secao, i) => (
          <li key={secao.id} className="flex gap-2 text-sm leading-snug">
            <span className="w-4 shrink-0 text-right font-mono text-[0.7rem] leading-5 text-muted-foreground">
              {i + 1}
            </span>
            <a
              href={`#${secao.id}`}
              className="text-muted-foreground transition-colors hover:text-primary"
            >
              {secao.titulo}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Shell dos documentos legais públicos (`/termos` e `/privacidade`). São páginas
 * abertas — precisam abrir sem sessão, porque é assim que o Google e o Stripe
 * checam os documentos antes de liberar o login social e a cobrança.
 *
 * Usa o mesmo escopo `[data-auth-shell]` das telas de autenticação: visual claro
 * e acento teal fixos, independentes do tema escolhido no app.
 */
export function LegalLayout({
  title,
  description,
  resumo,
  secoes,
  outroDocumento,
}: Props) {
  // Sem gerenciador de <head> no projeto: o título da aba é definido aqui porque
  // estas páginas são abertas direto pela URL, fora do fluxo do app.
  useEffect(() => {
    const anterior = document.title;
    document.title = `${title} · ${EMPRESA.produto}`;
    return () => {
      document.title = anterior;
    };
  }, [title]);

  return (
    <div
      data-auth-shell
      className="min-h-screen bg-background text-foreground"
      style={{ '--radius': '0.625rem' } as CSSProperties}
    >
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/login" aria-label={`Início do ${EMPRESA.produto}`}>
            <BrandLockup />
          </Link>
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            Voltar para o login
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
        <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_14rem]">
          <main className="min-w-0 max-w-3xl">
            <p className="font-mono text-xs tracking-wide text-primary">
              // documento legal
            </p>
            <h1 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] text-balance sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {description}
            </p>
            <p className="mt-4 font-mono text-[0.7rem] text-muted-foreground">
              Última atualização: {ATUALIZADO_EM}
            </p>

            <div className="mt-8 rounded-xl border border-border bg-muted/50 p-5">
              <p className="mb-3 text-sm font-semibold tracking-[-0.01em]">
                Em resumo
              </p>
              <div className="space-y-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
                {resumo}
              </div>
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                Este resumo é só para facilitar a leitura. O que vale é o texto
                completo abaixo.
              </p>
            </div>

            {/* Índice inline até o xl, onde ele passa a ser a coluna fixa. */}
            <Indice
              secoes={secoes}
              className="mt-8 rounded-xl border border-border p-5 xl:hidden"
            />

            <div className="mt-12 space-y-12">
              {secoes.map((secao, i) => (
                <section key={secao.id} id={secao.id} className="scroll-mt-20">
                  <h2 className="flex gap-3 text-lg font-bold tracking-[-0.02em] text-balance">
                    <span className="font-mono text-sm leading-7 text-primary">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {secao.titulo}
                  </h2>
                  <div className="mt-4 space-y-4">{secao.corpo}</div>
                </section>
              ))}
            </div>

            <Separator className="my-12" />

            <footer className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[0.7rem] text-muted-foreground">
                {EMPRESA.nome} © 2026 · {EMPRESA.dominio}
              </p>
              <Link
                to={outroDocumento.to}
                className="text-sm font-medium text-primary hover:underline"
              >
                {outroDocumento.label}
              </Link>
            </footer>
          </main>

          <Indice
            secoes={secoes}
            className="hidden xl:sticky xl:top-24 xl:block xl:self-start"
          />
        </div>
      </div>
    </div>
  );
}
