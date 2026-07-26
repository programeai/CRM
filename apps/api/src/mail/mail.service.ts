import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { passwordResetEmail } from './templates/password-reset.template';
import { collaboratorInviteEmail } from './templates/collaborator-invite.template';

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
      this.logger.warn({
        evento: 'email.smtp_desabilitado',
        msg: 'SMTP desabilitado — e-mail de redefinição não enviado.',
        destinatario: to,
        // O link carrega o token de redefinição: fora de desenvolvimento ele não
        // entra no log (o Grafana é publicado e a linha vive 30 dias).
        ...(process.env.NODE_ENV === 'production' ? {} : { resetUrl }),
      });
      return;
    }

    const { subject, text, html } = passwordResetEmail({
      resetUrl,
      appUrl:
        this.config.get<string>('FRONTEND_URL') ||
        'https://crm.programeai.com.br',
    });

    try {
      await this.getTransporter().sendMail({
        from: this.from,
        to,
        subject,
        text,
        html,
      });
    } catch (err) {
      this.logger.error(
        {
          evento: 'email.envio_falhou',
          msg: 'Falha ao enviar e-mail de redefinição de senha.',
          destinatario: to,
        },
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /**
   * Envia o convite de colaborador. Mesmo contrato do reset: sem SMTP, o link
   * só é logado (em dev) — e o painel exibe o link para o owner repassar, então
   * o fluxo nunca depende do e-mail ter saído.
   */
  async sendCollaboratorInvite(params: {
    to: string;
    name: string;
    ownerName: string;
    roleName: string;
    inviteUrl: string;
  }): Promise<void> {
    const { to, name, ownerName, roleName, inviteUrl } = params;
    if (!this.isEnabled()) {
      this.logger.warn({
        evento: 'email.smtp_desabilitado',
        msg: 'SMTP desabilitado — e-mail de convite não enviado.',
        destinatario: to,
        // O link carrega o token do convite: fora de desenvolvimento ele não
        // entra no log (o Grafana é publicado e a linha vive 30 dias).
        ...(process.env.NODE_ENV === 'production' ? {} : { inviteUrl }),
      });
      return;
    }

    const { subject, text, html } = collaboratorInviteEmail({
      name,
      ownerName,
      roleName,
      inviteUrl,
      appUrl:
        this.config.get<string>('FRONTEND_URL') ||
        'https://crm.programeai.com.br',
    });

    try {
      await this.getTransporter().sendMail({
        from: this.from,
        to,
        subject,
        text,
        html,
      });
    } catch (err) {
      this.logger.error(
        {
          evento: 'email.envio_falhou',
          msg: 'Falha ao enviar e-mail de convite de colaborador.',
          destinatario: to,
        },
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
