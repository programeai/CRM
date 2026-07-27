import { button, escapeHtml, paragraph, renderLayout } from './layout';
import type { EmailContent } from './password-reset.template';

type Input = {
  /** Conteúdo neutro da notificação — texto puro, vindo do core. */
  conteudo: {
    titulo: string;
    corpo: string;
    /** Caminho relativo no front (`/propostas/<id>`); nulo quando não há tela. */
    link: string | null;
  };
  /** Base pública do CRM (`FRONTEND_URL`), usada no botão e no rodapé. */
  appUrl: string;
};

/**
 * E-mail de uma notificação. É a **terceira costura**: o core produz texto puro
 * e é aqui — e só aqui — que ele vira HTML.
 *
 * `paragraph()` recebe **HTML cru**, então todo dado de negócio interpolado passa
 * por `escapeHtml`: título e corpo carregam nome de cliente digitado pelo
 * usuário. Mesmo cuidado de `collaborator-invite.template.ts:41`.
 */
export function notificationEmail({ conteudo, appUrl }: Input): EmailContent {
  const base = appUrl.replace(/\/+$/, '');
  const url = conteudo.link ? `${base}${conteudo.link}` : null;

  const content = [
    paragraph(escapeHtml(conteudo.corpo), { top: '14px' }),
    ...(url ? [button(url, 'Abrir no CRM')] : []),
  ].join('\n                    ');

  return {
    subject: `${conteudo.titulo} — CRM ProgrameAi`,
    text: [
      conteudo.titulo,
      '',
      conteudo.corpo,
      ...(url ? ['', url] : []),
      '',
      '—',
      `E-mail automático do CRM ProgrameAi · ${appUrl}`,
    ].join('\n'),
    html: renderLayout({
      preheader: conteudo.corpo,
      eyebrow: 'notificação',
      title: conteudo.titulo,
      content,
      appUrl,
    }),
  };
}
