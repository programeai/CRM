import { BRAND } from './brand';

/**
 * Casca visual compartilhada por todos os e-mails do CRM: fundo neutro, card
 * branco com filete teal no topo, wordmark ProgrameAi e rodapé.
 *
 * Regras de e-mail que ditam o formato do HTML abaixo (não "modernize" para
 * flex/grid): layout em tabelas, estilo inline em tudo que precisa aparecer no
 * Outlook, e um único `<style>` reservado a media queries — dark mode e
 * responsividade — que os clientes que o suportam aplicam por cima.
 */

const MAX_WIDTH = 600;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wordmark tipográfico (espelha `apps/web/src/components/ui/wordmark.tsx`). */
function wordmark(fontSize: string): string {
  return `<span style="font-family:${BRAND.fontSans};font-size:${fontSize};font-weight:800;letter-spacing:-0.03em;">
        <span class="e-wordmark" style="color:${BRAND.text};">Programe</span><span class="e-accent" style="color:${BRAND.primary};">Ai</span>
      </span>`;
}

/**
 * Parágrafo de corpo. `tone: 'muted'` para texto secundário (nota de segurança,
 * instruções), `'default'` para o texto principal.
 */
export function paragraph(
  html: string,
  {
    tone = 'default',
    top = '0',
  }: { tone?: 'default' | 'muted'; top?: string } = {},
): string {
  const color = tone === 'muted' ? BRAND.muted : BRAND.text;
  const size = tone === 'muted' ? '13px' : '15px';
  return `<p class="${tone === 'muted' ? 'e-muted' : 'e-text'}" style="margin:${top} 0 0;font-family:${BRAND.fontSans};font-size:${size};line-height:1.65;color:${color};">${html}</p>`;
}

/** Botão principal — tabela com `bgcolor` para sobreviver ao Outlook. */
export function button(href: string, label: string): string {
  const url = escapeHtml(href);
  return `<table role="presentation" class="e-btn-wrap" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
        <tr>
          <td class="e-btn" bgcolor="${BRAND.primary}" style="background-color:${BRAND.primary};border-radius:${BRAND.radiusSm};">
            <a href="${url}" class="e-btn-link" style="display:inline-block;padding:14px 30px;font-family:${BRAND.fontSans};font-size:15px;font-weight:700;line-height:1;letter-spacing:-0.01em;color:${BRAND.primaryForeground};text-decoration:none;border-radius:${BRAND.radiusSm};">${escapeHtml(label)}</a>
          </td>
        </tr>
      </table>`;
}

/** Pílula de metadado (ex.: validade do link). */
export function pill(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">
        <tr>
          <td class="e-soft" style="background-color:${BRAND.soft};border:1px solid ${BRAND.border};border-radius:999px;padding:6px 14px;font-family:${BRAND.fontMono};font-size:12px;line-height:1.4;color:${BRAND.muted};">${escapeHtml(text)}</td>
        </tr>
      </table>`;
}

/** Bloco com o endereço cru, para quando o botão não é clicável. */
export function urlBox(href: string): string {
  const url = escapeHtml(href);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;">
        <tr>
          <td class="e-soft" style="background-color:${BRAND.soft};border:1px solid ${BRAND.border};border-radius:${BRAND.radiusSm};padding:12px 14px;">
            <a href="${url}" class="e-accent" style="font-family:${BRAND.fontMono};font-size:12px;line-height:1.6;color:${BRAND.primary};text-decoration:none;word-break:break-all;">${url}</a>
          </td>
        </tr>
      </table>`;
}

export function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px;">
        <tr><td class="e-divider" style="border-top:1px solid ${BRAND.border};font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>`;
}

type LayoutInput = {
  /** Texto de pré-visualização na caixa de entrada (não aparece no corpo). */
  preheader: string;
  /** Sobrelinha mono no topo do card, no estilo `// assunto`. */
  eyebrow: string;
  title: string;
  /** Blocos do corpo já montados (use os helpers acima). */
  content: string;
  /** Base pública do CRM, usada no rodapé. */
  appUrl: string;
};

export function renderLayout({
  preheader,
  eyebrow,
  title,
  content,
  appUrl,
}: LayoutInput): string {
  const host = appUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  /* Tema escuro. Aplicado pelos clientes que respeitam a media query (Apple
     Mail, Outlook iOS/macOS, Thunderbird); os demais mantêm o tema claro. */
  @media (prefers-color-scheme: dark) {
    /* O body entra junto: sem ele sobra uma faixa clara abaixo do conteúdo. */
    body, .e-page { background-color: ${BRAND.darkPage} !important; }
    .e-card { background-color: ${BRAND.darkCard} !important; border-color: ${BRAND.darkBorder} !important; }
    .e-soft { background-color: ${BRAND.darkSoft} !important; border-color: ${BRAND.darkBorder} !important; }
    .e-divider { border-color: ${BRAND.darkBorder} !important; }
    .e-text { color: ${BRAND.darkText} !important; }
    .e-muted { color: ${BRAND.darkMuted} !important; }
    .e-wordmark { color: #FFFFFF !important; }
    .e-accent { color: ${BRAND.darkAccent} !important; }
    .e-btn { background-color: ${BRAND.darkPrimary} !important; }
    .e-btn-link { color: #FFFFFF !important; }
  }
  /* Outlook.com/Hotmail no modo escuro (não suporta a media query). */
  [data-ogsc] body, [data-ogsc] .e-page { background-color: ${BRAND.darkPage} !important; }
  [data-ogsc] .e-card { background-color: ${BRAND.darkCard} !important; border-color: ${BRAND.darkBorder} !important; }
  [data-ogsc] .e-soft { background-color: ${BRAND.darkSoft} !important; border-color: ${BRAND.darkBorder} !important; }
  [data-ogsc] .e-text { color: ${BRAND.darkText} !important; }
  [data-ogsc] .e-muted { color: ${BRAND.darkMuted} !important; }
  [data-ogsc] .e-wordmark { color: #FFFFFF !important; }
  [data-ogsc] .e-accent { color: ${BRAND.darkAccent} !important; }

  @media only screen and (max-width: 620px) {
    .e-shell { width: 100% !important; }
    .e-outer { padding: 24px 12px !important; }
    .e-inner { padding: 28px 22px 26px !important; }
    .e-title { font-size: 22px !important; }
    /* Botão de largura cheia no mobile, onde o alvo de toque importa. */
    .e-btn-wrap { width: 100% !important; }
    .e-btn-link { display: block !important; text-align: center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.page};-webkit-font-smoothing:antialiased;">
  <!-- Pré-visualização: some no corpo, aparece na lista da caixa de entrada. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

  <table role="presentation" class="e-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.page};">
    <tr>
      <td align="center" class="e-outer" style="padding:44px 16px;">
        <table role="presentation" class="e-shell" width="${MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${MAX_WIDTH}px;max-width:${MAX_WIDTH}px;">

          <!-- Assinatura da marca -->
          <tr>
            <td align="left" style="padding:0 4px 20px;">
              ${wordmark('20px')}
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td>
              <table role="presentation" class="e-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:${BRAND.radius};">
                <!-- Filete de acento: única superfície tingida com o teal. -->
                <tr>
                  <td height="4" style="height:4px;line-height:4px;font-size:0;background-color:${BRAND.primary};border-radius:${BRAND.radius} ${BRAND.radius} 0 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="e-inner" style="padding:36px 36px 32px;">
                    <p class="e-accent" style="margin:0 0 12px;font-family:${BRAND.fontMono};font-size:12px;line-height:1.4;letter-spacing:0.01em;color:${BRAND.primary};">// ${escapeHtml(eyebrow)}</p>
                    <h1 class="e-text e-title" style="margin:0;font-family:${BRAND.fontSans};font-size:25px;font-weight:800;line-height:1.2;letter-spacing:-0.02em;color:${BRAND.text};">${escapeHtml(title)}</h1>
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td align="left" style="padding:24px 4px 0;">
              ${wordmark('14px')}
              <p class="e-muted" style="margin:6px 0 0;font-family:${BRAND.fontMono};font-size:11px;line-height:1.6;color:${BRAND.muted};">// crm comercial para agências</p>
              <p class="e-muted" style="margin:14px 0 0;font-family:${BRAND.fontSans};font-size:12px;line-height:1.6;color:${BRAND.muted};">
                E-mail automático do ProgrameAi CRM — não é necessário responder.<br>
                <a href="${escapeHtml(appUrl)}" class="e-accent" style="color:${BRAND.primary};text-decoration:none;">${escapeHtml(host)}</a> · ProgrameAi © ${year}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
