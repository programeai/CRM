import { cn } from '@/lib/utils';
import { TEAL_ON_DARK, Wordmark } from './wordmark';

/**
 * Símbolo da marca ProgrameAi. Desenhado com `currentColor` (e não como `<img>`)
 * para acompanhar o tom de quem o renderiza — o mesmo acento do "Ai" do
 * wordmark, em tema claro e escuro.
 *
 * Este é o mesmo traçado de `public/favicon.svg` (aba do navegador) e de
 * `public/marca/simbolo*.png` (e-mail). Ao trocar o desenho, troque os três.
 */
export function BrandSymbol({ className, ...rest }: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 131 129"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={cn('shrink-0 select-none', className)}
      {...rest}
    >
      <path d="M56.9511 0.246568C69.9174 -0.876298 81.7119 1.8199 93.4202 8.66471C91.838 9.26369 90.9281 9.78493 89.9578 9.94877C76.8988 12.1541 66.7253 18.8334 58.9129 29.4569C57.6787 31.1352 55.585 32.4731 53.607 33.2638C43.9346 37.1303 36.9097 43.3085 34.4303 53.8359C30.5379 70.3629 45.1828 85.0117 61.68 81.0652C65.8831 80.0597 67.2571 80.8007 68.5709 84.9677C68.7847 85.6461 68.8238 86.6893 68.448 87.1977C62.6581 95.0314 56.7903 102.764 46.7347 105.633C31.8165 109.889 15.1237 102.659 7.15924 87.8344C-3.91713 67.2171 -1.68503 46.9884 10.71 27.8512C21.4041 11.3402 37.319 2.75878 56.9511 0.246568Z" />
      <path d="M109.714 26.3035C122.346 33.3906 128.283 44.7051 130.329 58.1909C135.947 95.2243 105.532 129.342 68.0769 128.261C59.6553 128.017 51.8082 125.624 44.4918 121.474C43.9926 121.191 43.5777 120.759 42.731 120.083C43.7473 119.618 44.384 119.203 45.081 119.025C57.4392 115.873 66.4703 107.969 74.5228 98.598C75.6758 97.2562 77.256 96.2702 78.6826 95.1773C82.8644 91.9739 87.6139 89.3073 91.1499 85.508C98.4139 77.7033 99.229 66.8947 94.0588 58.2978C89.0215 49.9219 79.1742 46.0275 68.8075 48.1641C67.5652 48.4202 65.8687 48.3691 64.901 47.705C62.0061 45.7186 61.9719 44.6556 63.9558 41.7229C65.327 39.696 66.589 37.5839 68.0887 35.6569C79.2796 21.2779 93.1295 18.1315 109.714 26.3035Z" />
    </svg>
  );
}

/* Escalas do lockup. `md` é a medida do header da sidebar, que é a referência
   da marca — as outras só sobem/descem proporcionalmente a partir dela. */
const SIZES = {
  sm: {
    symbol: 'size-5',
    wordmark: 'text-base',
    badge: 'px-1.5 py-0.5 text-[0.6rem]',
    gap: 'gap-1.5',
  },
  md: {
    symbol: 'size-6',
    wordmark: 'text-lg',
    badge: 'px-1.5 py-0.5 text-[0.65rem]',
    gap: 'gap-2',
  },
  lg: {
    symbol: 'size-8',
    wordmark: 'text-2xl',
    badge: 'px-2 py-0.5 text-[0.7rem]',
    gap: 'gap-2.5',
  },
} as const;

type Props = React.ComponentProps<'div'> & {
  tone?: 'light' | 'dark';
  size?: keyof typeof SIZES;
  /** Classes do grupo texto (wordmark + selo) — use para escondê-lo. */
  textClassName?: string;
};

/**
 * Lockup oficial do produto: **símbolo + wordmark ProgrameAi + selo "CRM"**.
 *
 * É a única forma de apresentar a marca na interface. Toda tela que exibe a
 * marca (sidebar, autenticação, documentos legais) usa este componente — nunca
 * o `Wordmark` solto nem o símbolo sozinho, para as superfícies não divergirem.
 * O par em HTML de e-mail vive em `apps/api/src/mail/templates/layout.ts`.
 */
export function BrandLockup({
  tone = 'light',
  size = 'md',
  className,
  textClassName,
  ...rest
}: Props) {
  const s = SIZES[size];
  const dark = tone === 'dark';

  return (
    <div className={cn('flex items-center', s.gap, className)} {...rest}>
      <BrandSymbol
        className={cn(s.symbol, !dark && 'text-primary')}
        style={dark ? { color: TEAL_ON_DARK } : undefined}
      />
      <div className={cn('flex items-center', s.gap, textClassName)}>
        <Wordmark tone={tone} className={s.wordmark} />
        <span
          className={cn(
            'rounded-md font-bold tracking-wider uppercase',
            s.badge,
            !dark && 'bg-primary/10 text-primary',
          )}
          style={
            dark
              ? { backgroundColor: 'rgba(84,201,196,0.16)', color: TEAL_ON_DARK }
              : undefined
          }
        >
          CRM
        </span>
      </div>
    </div>
  );
}
