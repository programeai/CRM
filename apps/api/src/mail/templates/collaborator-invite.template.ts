import {
  button,
  divider,
  escapeHtml,
  paragraph,
  pill,
  renderLayout,
  urlBox,
} from './layout';
import type { EmailContent } from './password-reset.template';

type Input = {
  /** Nome do convidado — abre a saudação. */
  name: string;
  /** Nome do owner que convidou (dono da conta). */
  ownerName: string;
  /** Papel atribuído, para o convidado saber o que vai encontrar. */
  roleName: string;
  /** Link do convite, com o token. */
  inviteUrl: string;
  /** Base pública do CRM (`FRONTEND_URL`), usada no rodapé. */
  appUrl: string;
};

/** Precisa acompanhar o `INVITE_TTL_DAYS` do `InvitesService`. */
const VALIDADE = '7 dias';

/**
 * Convite de colaborador. Mesmo formato do e-mail de redefinição de senha —
 * assunto, texto e HTML juntos, para o `MailService` só entregar ao SMTP.
 */
export function collaboratorInviteEmail({
  name,
  ownerName,
  roleName,
  inviteUrl,
  appUrl,
}: Input): EmailContent {
  const content = [
    paragraph(
      `Olá, <strong style="font-weight:600;">${escapeHtml(name)}</strong>! <strong style="font-weight:600;">${escapeHtml(ownerName)}</strong> te convidou para colaborar no CRM. Clique no botão abaixo para criar a sua senha e ativar o acesso.`,
      { top: '14px' },
    ),
    button(inviteUrl, 'Ativar meu acesso'),
    pill(`Seu papel: ${roleName} · o link expira em ${VALIDADE}`),
    paragraph(
      'Se o botão não funcionar, copie e cole este endereço no navegador:',
      { tone: 'muted', top: '26px' },
    ),
    urlBox(inviteUrl),
    divider(),
    paragraph(
      '<strong style="font-weight:600;">Não esperava este convite?</strong> Pode ignorar este e-mail — nenhum acesso é criado até que alguém abra o link acima e cadastre uma senha.',
      { tone: 'muted' },
    ),
  ].join('\n                    ');

  return {
    subject: `${ownerName} te convidou para o CRM ProgrameAi`,
    text: [
      'Convite para colaborar — CRM ProgrameAi',
      '',
      `Olá, ${name}!`,
      `${ownerName} te convidou para colaborar no CRM, com o papel "${roleName}".`,
      `Abra o endereço abaixo para criar a sua senha e ativar o acesso (o link expira em ${VALIDADE}):`,
      '',
      inviteUrl,
      '',
      'Não esperava este convite? Pode ignorar este e-mail — nenhum acesso é criado até que alguém abra o link e cadastre uma senha.',
      '',
      '—',
      `E-mail automático do CRM ProgrameAi · ${appUrl}`,
    ].join('\n'),
    html: renderLayout({
      preheader: `${ownerName} te convidou para colaborar no CRM (link válido por ${VALIDADE}).`,
      eyebrow: 'convite de acesso',
      title: 'Ative o seu acesso',
      content,
      appUrl,
    }),
  };
}
