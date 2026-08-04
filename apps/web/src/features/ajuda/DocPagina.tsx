import type { ReactNode } from 'react';

export type DocSecao = {
  /** Âncora da seção (`#id`), usada pelo índice. */
  id: string;
  titulo: string;
  corpo: ReactNode;
};

/** Índice das seções. Renderizado duas vezes (topo no mobile, coluna fixa no xl). */
function Indice({
  secoes,
  className,
}: {
  secoes: DocSecao[];
  className?: string;
}) {
  return (
    <nav aria-label="Índice da página" className={className}>
      <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        Nesta página
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
 * Shell de uma página de ajuda: título, uma linha de contexto, índice e seções
 * numeradas com âncora. É o mesmo desenho do `LegalLayout`, sem a moldura de
 * página pública — aqui o cabeçalho e as abas vêm do `AjudaLayout`, e o
 * cabeçalho da seção é `h2` porque o `h1` da tela é "Ajuda".
 */
export function DocPagina({
  titulo,
  descricao,
  secoes,
}: {
  titulo: string;
  descricao: ReactNode;
  secoes: DocSecao[];
}) {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_13rem]">
      <div className="min-w-0 max-w-3xl">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">{titulo}</h2>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            {descricao}
          </p>
        </div>

        {/* Índice inline até o xl, onde ele passa a ser a coluna fixa. */}
        <Indice
          secoes={secoes}
          className="mt-6 rounded-xl border border-border p-4 xl:hidden"
        />

        <div className="mt-10 space-y-10">
          {secoes.map((secao, i) => (
            <section key={secao.id} id={secao.id} className="scroll-mt-6">
              <h3 className="flex gap-3 text-base font-bold tracking-[-0.02em] text-balance">
                <span className="font-mono text-sm leading-6 text-primary">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {secao.titulo}
              </h3>
              <div className="mt-4 space-y-4">{secao.corpo}</div>
            </section>
          ))}
        </div>
      </div>

      <Indice
        secoes={secoes}
        className="hidden xl:sticky xl:top-6 xl:block xl:self-start"
      />
    </div>
  );
}
