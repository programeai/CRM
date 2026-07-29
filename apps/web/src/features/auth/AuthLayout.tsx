import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { BrandLockup } from '@/components/ui/brand-lockup';
import { TEAL_ON_DARK } from '@/components/ui/wordmark';

const PANEL_BG = '#0b1220';

const HIGHLIGHTS = [
  'Pipeline visual do lead ao fechamento',
  'Propostas e contratos prontos em minutos',
  'Projetos e financeiro sempre conectados',
];

/* Amostra do pipeline. Dados fictícios, só para dar vida à porta de entrada. */
const STAGES: {
  label: string;
  deals: { client: string; value: string; won?: boolean }[];
}[] = [
  {
    label: 'Lead',
    deals: [
      { client: 'Clínica Aurora', value: 'R$ 32.000' },
      { client: 'Studio Vello', value: 'R$ 18.500' },
    ],
  },
  {
    label: 'Proposta',
    deals: [{ client: 'Vitalis Saúde', value: 'R$ 74.000' }],
  },
  {
    label: 'Fechado',
    deals: [{ client: 'Nova Estética', value: 'R$ 124.000', won: true }],
  },
];

function PipelinePreview() {
  return (
    <div
      className="rounded-xl border p-4 shadow-2xl backdrop-blur-sm"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(255,255,255,0.10)',
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <span
          className="font-mono text-[0.7rem] tracking-wide"
          style={{ color: 'rgba(245,246,248,0.55)' }}
        >
          pipeline • julho
        </span>
        <span
          className="font-mono text-[0.7rem] font-medium"
          style={{ color: TEAL_ON_DARK }}
        >
          R$ 248.500 em jogo
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {STAGES.map((stage) => (
          <div key={stage.label} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: stage.deals[0]?.won ? TEAL_ON_DARK : 'rgba(245,246,248,0.35)' }}
              />
              <span
                className="font-mono text-[0.62rem] uppercase tracking-wider"
                style={{ color: 'rgba(245,246,248,0.5)' }}
              >
                {stage.label}
              </span>
            </div>
            {stage.deals.map((deal) => (
              <div
                key={deal.client}
                className="rounded-lg border p-2.5"
                style={{
                  backgroundColor: deal.won
                    ? 'rgba(14,124,123,0.16)'
                    : 'rgba(255,255,255,0.04)',
                  borderColor: deal.won
                    ? 'rgba(84,201,196,0.35)'
                    : 'rgba(255,255,255,0.08)',
                }}
              >
                <p className="text-[0.72rem] font-medium leading-tight text-white">
                  {deal.client}
                </p>
                <p
                  className="mt-1 font-mono text-[0.68rem]"
                  style={{ color: deal.won ? TEAL_ON_DARK : 'rgba(245,246,248,0.6)' }}
                >
                  {deal.value}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Painel de marca (esquerda). Escondido no mobile; é a peça de divulgação. */
function Showcase() {
  return (
    <aside
      className="relative hidden overflow-hidden lg:flex lg:flex-col"
      style={{ backgroundColor: PANEL_BG }}
    >
      {/* Brilho teal único e difuso — vida sem cair no berrante. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-[12%] -top-[18%] h-[65%] w-[65%] rounded-full opacity-25 blur-[130px]"
        style={{ background: 'radial-gradient(circle, #0e7c7b, transparent 70%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[22%] -left-[10%] h-[55%] w-[55%] rounded-full opacity-15 blur-[130px]"
        style={{ background: 'radial-gradient(circle, #0e7c7b, transparent 70%)' }}
      />

      {/* O painel rola como peça única: `min-h-full` + `justify-between` deixam
          a marca no topo e o rodapé no pé enquanto sobra espaço, e passam a
          rolar juntos quando não sobra — em vez de o discurso transbordar e ser
          pintado por cima do rodapé, como acontecia quando a altura era fixa. */}
      <div className="relative flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/15">
        <div
          className="flex min-h-full flex-col justify-between gap-10 px-12 xl:px-16"
          /* Respiro vertical acompanha a altura da janela: aperta em notebook
             baixo (onde cada pixel decide se cabe) sem achatar em tela grande. */
          style={{ paddingBlock: 'clamp(2rem, 6vh, 4rem)' }}
        >
          <BrandLockup tone="dark" size="lg" data-animate />

          <div className="max-w-md">
            <p
              data-animate
              className="font-mono text-xs tracking-wide"
              style={{ color: TEAL_ON_DARK, animationDelay: '80ms' }}
            >
              // crm comercial para agências
            </p>
            <h2
              data-animate
              className="mt-4 text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-balance text-white xl:text-[2.75rem]"
              style={{ animationDelay: '160ms' }}
            >
              Todo o comercial da sua agência em um só lugar.
            </h2>
            <p
              data-animate
              className="mt-5 text-[0.95rem] leading-relaxed"
              style={{ color: 'rgba(245,246,248,0.7)', animationDelay: '240ms' }}
            >
              Do primeiro lead ao contrato assinado. Pipeline, propostas,
              projetos e financeiro conversando entre si, sem planilha solta.
            </p>

            {/* A amostra é o pedaço mais alto do painel (~265px) e o único
                dispensável, então é ela que sai quando a janela não tem altura.
                Limiares medidos no painel montado: com a amostra o discurso
                exige ~1035px de altura; sem ela, cabe a partir de ~700px. */}
            <div
              data-animate
              className="mt-8 [@media(max-height:1040px)]:hidden"
              style={{ animationDelay: '320ms' }}
            >
              <PipelinePreview />
            </div>

            <ul
              data-animate
              className="mt-8 space-y-3"
              style={{ animationDelay: '400ms' }}
            >
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: 'rgba(14,124,123,0.25)' }}
                  >
                    <Check
                      className="size-3"
                      style={{ color: TEAL_ON_DARK }}
                      strokeWidth={3}
                    />
                  </span>
                  <span className="text-sm" style={{ color: 'rgba(245,246,248,0.82)' }}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p
            data-animate
            className="font-mono text-[0.7rem]"
            style={{ color: 'rgba(245,246,248,0.4)', animationDelay: '480ms' }}
          >
            ProgrameAi © 2026 · feito para quem vende software
          </p>
        </div>
      </div>
    </aside>
  );
}

type Props = {
  title: string;
  description: string;
  children: ReactNode;
};

/**
 * Shell das telas de autenticação: painel showcase de marca (esquerda) +
 * coluna de formulário (direita). O acento teal e o visual claro são fixados
 * pelo escopo `[data-auth-shell]` em `index.css`, independente do tema do app.
 */
export function AuthLayout({ title, description, children }: Props) {
  return (
    <div
      data-auth-shell
      className="grid h-dvh overflow-hidden bg-background text-foreground lg:grid-cols-[1.05fr_1fr]"
      style={{ '--radius': '0.625rem' } as CSSProperties}
    >
      <Showcase />

      {/* Só o formulário rola; o painel de marca fica fixo na altura da viewport.
          Centralizar com `my-auto` (e não `justify-center`) evita que o topo do
          conteúdo fique inalcançável quando ele passa da altura disponível. */}
      <main className="flex flex-col overflow-y-auto px-6 py-10 sm:px-10">
        <div data-animate className="mx-auto my-auto w-full max-w-sm">
          {/* Marca compacta — aparece no mobile, onde o showcase fica oculto. */}
          <div className="mb-8 lg:hidden">
            <BrandLockup />
          </div>

          <header className="mb-6">
            <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-balance">
              {title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          </header>

          {children}

          {/* Documentos legais alcançáveis de qualquer tela de entrada — é por
              aqui que o Google chega neles na verificação do login social. */}
          <nav className="mt-10 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <Link to="/termos" className="hover:text-primary hover:underline">
              Termos de Uso
            </Link>
            <span aria-hidden>·</span>
            <Link to="/privacidade" className="hover:text-primary hover:underline">
              Política de Privacidade
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
