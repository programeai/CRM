import {
  button,
  divider,
  paragraph,
  pill,
  renderLayout,
  urlBox,
} from './layout';

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

type Input = {
  /** Link de redefinição, com o token. */
  resetUrl: string;
  /** Base pública do CRM (`FRONTEND_URL`), usada no rodapé. */
  appUrl: string;
};

/** Precisa acompanhar o TTL do token em `AuthService`. */
const VALIDADE = '1 hora';

/**
 * E-mail de redefinição de senha. Devolve as três variantes juntas (assunto,
 * texto e HTML) para que o `MailService` só precise entregar ao SMTP.
 */
export function passwordResetEmail({ resetUrl, appUrl }: Input): EmailContent {
  const content = [
    paragraph(
      'Recebemos um pedido para redefinir a senha da sua conta no CRM. Clique no botão abaixo para cadastrar uma nova senha.',
      { top: '14px' },
    ),
    button(resetUrl, 'Redefinir senha'),
    pill(`O link expira em ${VALIDADE}`),
    paragraph(
      'Se o botão não funcionar, copie e cole este endereço no navegador:',
      { tone: 'muted', top: '26px' },
    ),
    urlBox(resetUrl),
    divider(),
    paragraph(
      '<strong style="font-weight:600;">Não foi você?</strong> Pode ignorar este e-mail — sua senha continua a mesma. Nada muda até que alguém abra o link acima e cadastre uma nova senha.',
      { tone: 'muted' },
    ),
  ].join('\n                    ');

  return {
    subject: 'Redefinição de senha no CRM ProgrameAi',
    text: [
      'Redefinir sua senha — CRM ProgrameAi',
      '',
      'Recebemos um pedido para redefinir a senha da sua conta no CRM.',
      `Abra o endereço abaixo para cadastrar uma nova senha (o link expira em ${VALIDADE}):`,
      '',
      resetUrl,
      '',
      'Não foi você? Pode ignorar este e-mail — sua senha continua a mesma.',
      '',
      '—',
      `E-mail automático do CRM ProgrameAi · ${appUrl}`,
    ].join('\n'),
    html: renderLayout({
      preheader: `Seu link para cadastrar uma nova senha (válido por ${VALIDADE}).`,
      eyebrow: 'segurança da conta',
      title: 'Redefinir sua senha',
      content,
      appUrl,
    }),
  };
}
