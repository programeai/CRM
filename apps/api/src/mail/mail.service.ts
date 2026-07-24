import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Envio de e-mail via SMTP (Nodemailer). Segue o mesmo padrão de "serviço
 * opcional" do CaptchaService/OAuth: sem `SMTP_HOST` configurado, o envio é
 * desabilitado e o conteúdo (ex.: link de redefinição) é apenas logado — mantém
 * o fluxo utilizável em dev sem um servidor de e-mail real.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('SMTP_HOST'));
  }

  private get from(): string {
    return (
      this.config.get<string>('MAIL_FROM') ||
      this.config.get<string>('SMTP_USER') ||
      'no-reply@localhost'
    );
  }

  /** Cria (uma vez) o transporter SMTP a partir das variáveis de ambiente. */
  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: this.config.get<number>('SMTP_PORT') ?? 587,
        secure: this.config.get<boolean>('SMTP_SECURE') ?? false,
        auth: this.config.get<string>('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASSWORD'),
            }
          : undefined,
      });
    }
    return this.transporter;
  }

  /**
   * Envia o e-mail de redefinição de senha. Sem SMTP configurado, registra o
   * link no log em nível `warn` para permitir o fluxo em desenvolvimento.
   */
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.warn(
        `SMTP desabilitado — link de redefinição para ${to}: ${resetUrl}`,
      );
      return;
    }

    try {
      await this.getTransporter().sendMail({
        from: this.from,
        to,
        subject: 'Redefinição de senha no CRM ProgrameAi',
        text: [
          'Recebemos um pedido para redefinir a sua senha.',
          '',
          `Abra o link abaixo para cadastrar uma nova senha (válido por 1 hora):`,
          resetUrl,
          '',
          'Se você não fez essa solicitação, ignore este e-mail.',
        ].join('\n'),
        html: [
          '<p>Recebemos um pedido para redefinir a sua senha.</p>',
          '<p>Clique no botão abaixo para cadastrar uma nova senha (válido por 1 hora):</p>',
          `<p><a href="${resetUrl}">Redefinir senha</a></p>`,
          `<p>Ou copie e cole este endereço no navegador:<br>${resetUrl}</p>`,
          '<p>Se você não fez essa solicitação, ignore este e-mail.</p>',
        ].join(''),
      });
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de redefinição para ${to}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
