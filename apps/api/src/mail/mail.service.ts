import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  passwordResetEmail,
  type EmailContent,
} from './templates/password-reset.template';
import { collaboratorInviteEmail } from './templates/collaborator-invite.template';
import { accountDeletionScheduledEmail } from './templates/account-deletion-scheduled.template';

/** O que aconteceu com um envio. `disabled` não é falha — é SMTP ausente. */
export type ResultadoDeEnvio = { status: 'sent' } | { status: 'disabled' };

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
   * Envio genérico. Ao contrário de `sendPasswordReset`/`sendCollaboratorInvite`,
   * **propaga** a exceção do SMTP: quem chama decide se engole (os dois fluxos de
   * link, que têm fallback pela interface) ou se registra a falha e reagenda (o
   * `EmailChannel`, cujo retry depende de saber que falhou).
   *
   * Devolver `disabled` em vez de lançar mantém o contrato de "serviço opcional":
   * sem `SMTP_HOST`, nada é enviado e ninguém quebra.
   */
  private async send(
    to: string,
    conteudo: EmailContent,
  ): Promise<ResultadoDeEnvio> {
    if (!this.isEnabled()) return { status: 'disabled' };
    await this.getTransporter().sendMail({
      from: this.from,
      to,
      subject: conteudo.subject,
      text: conteudo.text,
      html: conteudo.html,
    });
    return { status: 'sent' };
  }

  /** Envio de notificação. Propaga a falha — é o que alimenta o retry do outbox. */
  async sendNotification(
    to: string,
    conteudo: EmailContent,
  ): Promise<ResultadoDeEnvio> {
    return this.send(to, conteudo);
  }

  /** Envio do digest diário. Mesmo contrato do `sendNotification`. */
  async sendDigest(
    to: string,
    conteudo: EmailContent,
  ): Promise<ResultadoDeEnvio> {
    return this.send(to, conteudo);
  }

  /**
   * Envia o e-mail de redefinição de senha. Sem SMTP configurado, registra o
   * link no log em nível `warn` para permitir o fluxo em desenvolvimento.
   *
   * **Engole** a falha de propósito e devolve `void`: este fluxo tem fallback
   * pela interface, e mudar o contrato dele não pertence a esta fase.
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

    try {
      await this.send(
        to,
        passwordResetEmail({
          resetUrl,
          appUrl:
            this.config.get<string>('FRONTEND_URL') ||
            'https://crm.programeai.com.br',
        }),
      );
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

    try {
      await this.send(
        to,
        collaboratorInviteEmail({
          name,
          ownerName,
          roleName,
          inviteUrl,
          appUrl:
            this.config.get<string>('FRONTEND_URL') ||
            'https://crm.programeai.com.br',
        }),
      );
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

  /**
   * Avisa que o encerramento da conta foi agendado. Mesmo contrato do reset e
   * do convite: **engole** a falha — o aviso na interface (banner + toast) é o
   * caminho que não depende de SMTP. Sem SMTP, registra o agendamento no log
   * (sem link: não há token) para permitir o fluxo em desenvolvimento.
   */
  async sendAccountDeletionScheduled(params: {
    to: string;
    name: string;
    scheduledFor: Date;
  }): Promise<void> {
    const { to, scheduledFor } = params;
    if (!this.isEnabled()) {
      this.logger.warn({
        evento: 'email.smtp_desabilitado',
        msg: 'SMTP desabilitado — e-mail de encerramento agendado não enviado.',
        destinatario: to,
      });
      return;
    }

    try {
      await this.send(
        to,
        accountDeletionScheduledEmail({
          scheduledFor,
          appUrl:
            this.config.get<string>('FRONTEND_URL') ||
            'https://crm.programeai.com.br',
        }),
      );
    } catch (err) {
      this.logger.error(
        {
          evento: 'email.envio_falhou',
          msg: 'Falha ao enviar e-mail de encerramento agendado.',
          destinatario: to,
        },
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
