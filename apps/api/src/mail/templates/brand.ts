/**
 * Tokens de marca para e-mail — espelho do design system do front
 * (`apps/web/src/index.css`) convertido para hex.
 *
 * Clientes de e-mail não suportam `oklch()` nem variáveis CSS, então os valores
 * precisam viver literais aqui. Ao alterar um token no front, atualize o par
 * correspondente nesta tabela para o e-mail não sair fora da identidade.
 */
export const BRAND = {
  /* ── Tema claro (padrão do e-mail) ───────────────────────────────── */
  /** `--muted`/`--secondary` — fundo da página, fora do card. */
  page: '#F3F4F6',
  /** `--card` */
  card: '#FFFFFF',
  /** Superfície de apoio dentro do card (blocos de link, pílulas). */
  soft: '#F7F8FA',
  /** `--border` */
  border: '#E5E7EB',
  /** `--foreground` */
  text: '#0F1729',
  /** `--muted-foreground` */
  muted: '#6B7280',
  /** `--primary` — teal ProgrameAi, usado só como acento. */
  primary: '#0E7C7B',
  /** `--primary-foreground` */
  primaryForeground: '#FFFFFF',

  /* ── Tema escuro (`prefers-color-scheme: dark`) ──────────────────── */
  /** Painel escuro da marca, o mesmo do showcase de autenticação. */
  darkPage: '#0B1220',
  darkCard: '#151C2B',
  darkSoft: '#1C2436',
  darkBorder: '#2A3346',
  darkText: '#F7F6F3',
  darkMuted: '#9AA3B2',
  /** `--primary` do tema escuro. */
  darkPrimary: '#0F9A94',
  /** Teal clareado para texto sobre fundo escuro (igual ao `Wordmark`). */
  darkAccent: '#54C9C4',

  /* ── Forma e tipografia ──────────────────────────────────────────── */
  /** `--radius-xl` (0.625rem × 1.4 ≈ 14px) — card. */
  radius: '14px',
  /** `--radius-lg` (0.625rem = 10px) — botão e blocos internos. */
  radiusSm: '10px',
  fontSans:
    "'Geist Variable',Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
  fontMono:
    "ui-monospace,SFMono-Regular,Menlo,Consolas,'Roboto Mono','Courier New',monospace",
} as const;
