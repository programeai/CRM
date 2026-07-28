import { button, divider, paragraph, pill, renderLayout } from './layout';
import type { EmailContent } from './password-reset.template';

type Input = {
  /** Data em que o expurgo acontece, se a carência não for cancelada. */
  scheduledFor: Date;
  /** Base pública do CRM (`FRONTEND_URL`), usada no rodapé e no link. */
  appUrl: string;
};

function formatarData(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * Aviso de encerramento agendado. **Sem link com token**: quem cancela é quem
 * consegue entrar no CRM, e um token de cancelamento por e-mail criaria um
 * segredo novo para quebrar na autohospedagem sem SMTP.
 */
export function accountDeletionScheduledEmail({
  scheduledFor,
  appUrl,
}: Input): EmailContent {
  const data = formatarData(scheduledFor);
  const caminho = `${appUrl.replace(/\/$/, '')}/configuracoes/conta`;

  const content = [
    paragraph(
      `O encerramento da sua conta no CRM ProgrameAi foi agendado para <strong style="font-weight:600;">${data}</strong>. Até lá, o CRM continua funcionando normalmente.`,
      { top: '14px' },
    ),
    button(caminho, 'Cancelar o encerramento'),
    pill('Passada a data, a exclusão é definitiva e não pode ser desfeita'),
    divider(),
    paragraph(
      '<strong style="font-weight:600;">Não foi você?</strong> Entre na conta e cancele o encerramento em Configurações → Conta o quanto antes.',
      { tone: 'muted' },
    ),
  ].join('\n                    ');

  return {
    subject: 'Encerramento da sua conta no CRM ProgrameAi agendado',
    text: [
      'Encerramento de conta agendado — CRM ProgrameAi',
      '',
      `O encerramento da sua conta foi agendado para ${data}. Até lá, o CRM continua funcionando normalmente.`,
      'Para cancelar, entre na conta e acesse Configurações → Conta:',
      '',
      caminho,
      '',
      'Passada a data, a exclusão é definitiva e não pode ser desfeita.',
      '',
      '—',
      `E-mail automático do CRM ProgrameAi · ${appUrl}`,
    ].join('\n'),
    html: renderLayout({
      preheader: `Encerramento agendado para ${data} — cancele a qualquer momento antes disso.`,
      eyebrow: 'segurança da conta',
      title: 'Encerramento de conta agendado',
      content,
      appUrl,
    }),
  };
}
