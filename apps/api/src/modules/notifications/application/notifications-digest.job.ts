import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { NotificationType } from '@prisma/client';
import { MailService } from '../../../mail/mail.service';
import {
  digestEmail,
  type ItemDeDigest,
} from '../../../mail/templates/digest.template';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';
import {
  NOTIFICATION_TARGET_REPOSITORY,
  type NotificationTargetRepository,
} from '../domain/notification-target.repository';

/** Janela do resumo: o que entrou desde o digest de ontem. */
const JANELA_HORAS = 24;

/**
 * Rótulo pt-BR do tipo, para o cabeçalho de grupo do digest. Espelha o
 * `NOTIFICATION_TYPE_LABELS` do `apps/web` — o e-mail não passa pelo front, então
 * a tradução tem de existir aqui também (regra de rótulo de domínio do projeto).
 */
const TIPO_LABEL: Record<NotificationType, string> = {
  FOLLOW_UP_DUE: 'Follow-up de hoje',
  DEAL_STALE: 'Oportunidade esfriando',
  PROPOSAL_EXPIRING: 'Proposta a expirar',
  PAYMENT_DUE: 'Cobrança a vencer',
  PAYMENT_OVERDUE: 'Cobrança vencida',
  TASK_OVERDUE: 'Demanda atrasada',
  RECORD_ASSIGNED: 'Atribuído a você',
  LEAD_RECEIVED: 'Lead recebido',
};

@Injectable()
export class NotificationsDigestJob {
  private readonly logger = new Logger(NotificationsDigestJob.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: NotificationRepository,
    @Inject(NOTIFICATION_TARGET_REPOSITORY)
    private readonly targets: NotificationTargetRepository,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Digest diário. 7h no fuso de São Paulo, não 7h UTC: um "resumo do dia" no
   * horário errado estaria errado na prática. Não há `TZ` no compose nem no
   * Dockerfile, então o container é UTC e o `timeZone:` é obrigatório — hoje
   * declarado em todos os crons do projeto (os legados rodavam sem ele, três
   * horas antes do que o nome anunciava, até o gatilho (f) pagar a dívida).
   *
   * Roda uma hora depois do `NotificationsRemindersJob` (6h BRT), para que o
   * resumo já inclua os lembretes de prazo emitidos hoje.
   */
  @Cron('0 7 * * *', {
    name: 'notificacoes-digest',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> {
    // Sem SMTP o digest simplesmente não existe — é o contrato de "serviço
    // opcional", e aqui não há o escape de UX que o convite tem (o painel
    // devolvendo o link).
    if (!this.mail.isEnabled()) return;

    const desde = new Date(Date.now() - JANELA_HORAS * 60 * 60 * 1000);
    const destinos = await this.targets.findDestinosDeDigestPeloSistema();
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? '';

    let enviados = 0;
    let falhas = 0;
    for (const destino of destinos) {
      // `try/catch` POR USUÁRIO: um endereço que o SMTP recusa não pode impedir
      // o resumo de todos os outros.
      try {
        const notificacoes = await this.repo.findParaDigestPeloSistema(
          destino.ownerId,
          destino.userId,
          desde,
        );
        // Quem não teve novidade nenhuma não recebe e-mail vazio.
        if (notificacoes.length === 0) continue;

        const itens: ItemDeDigest[] = notificacoes.map((n) => ({
          grupo: TIPO_LABEL[n.type],
          titulo: n.title,
          corpo: n.body,
        }));
        await this.mail.sendDigest(
          destino.email,
          digestEmail({ itens, appUrl }),
        );
        enviados++;
      } catch (erro) {
        falhas++;
        // Sem o e-mail e sem os títulos: o Grafana é publicado na internet.
        this.logger.error({
          evento: 'digest.envio_falhou',
          msg: 'Falha ao enviar o resumo diário para um usuário.',
          usuarioId: destino.userId,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }

    if (enviados > 0 || falhas > 0) {
      this.logger.log({
        evento: 'digest.enviado',
        msg: 'Resumo diário enviado.',
        quantidade: enviados,
        falhas,
      });
    }
  }
}
