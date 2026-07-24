import { cn } from '@/lib/utils';

/* Teal da marca clareado o suficiente para contrastar sobre painel escuro. */
const TEAL_ON_DARK = '#54c9c4';

/**
 * Wordmark tipográfico ProgrameAi: sans peso 800 com o "Ai" no acento da marca.
 * É a assinatura visual da marca — use sempre este componente para renderizar o
 * nome (login, sidebar, etc.), nunca texto solto.
 */
export function Wordmark({
  tone = 'light',
  className,
  ...rest
}: React.ComponentProps<'span'> & { tone?: 'light' | 'dark' }) {
  return (
    <span
      className={cn('font-sans font-extrabold tracking-[-0.03em] select-none', className)}
      {...rest}
    >
      <span className={tone === 'dark' ? 'text-white' : 'text-foreground'}>
        Programe
      </span>
      <span
        className={tone === 'light' ? 'text-primary' : undefined}
        style={tone === 'dark' ? { color: TEAL_ON_DARK } : undefined}
      >
        Ai
      </span>
    </span>
  );
}
