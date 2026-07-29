import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PROPOSAL_REPOSITORY,
  type ProposalRepository,
} from '../domain/proposal.repository';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** Nome exibido na tela de auditoria para as rotinas diárias. */
const ATOR_ROTINA = 'Rotina diária';

@Injectable()
export class ProposalsExpirationJob {
  private readonly logger = new Logger(ProposalsExpirationJob.name);

  constructor(
    @Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Expira a proposta cuja validade passou. `timeZone` explícito pela mesma razão
   * do `FinanceBillingJob`: o container é UTC, e sem isto a proposta que vale
   * "até hoje" expiraria à meia-noite BRT — o dia inteiro que o cliente ainda
   * tinha para aceitar.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'propostas-expiracao',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> {
    const expiradas = await this.repo.expireOverdue(new Date());
    for (const p of expiradas) {
      await this.audit.registrarPeloSistema({
        ownerId: p.ownerId,
        actorType: 'CRON',
        actorName: ATOR_ROTINA,
        entity: 'PROPOSAL',
        entityId: p.id,
        entityLabel: p.number,
        action: 'EXPIRAR',
        antes: { status: p.status },
        depois: { status: 'EXPIRED' },
      });
      // Gatilho (b), no momento "já expirou". O `NotificationsRemindersJob`
      // cobre o outro momento — "vai expirar em 3 dias" — e o `dedupeKey`
      // diferente (`PROPOSAL_EXPIRED:` vs `PROPOSAL_EXPIRING:`) garante que a
      // pessoa receba os DOIS avisos, não um só.
      await this.notifications.notificarPeloSistema({
        ownerId: p.ownerId,
        userId: p.assigneeId ?? p.ownerId,
        dedupeKey: `PROPOSAL_EXPIRED:${p.id}`,
        evento: {
          tipo: 'PROPOSAL_EXPIRING',
          entityId: p.id,
          numero: p.number,
          clienteNome: p.clienteNome,
          dataAlvo: p.validUntil,
        },
      });
    }
    if (expiradas.length > 0) {
      this.logger.log({
        evento: 'propostas.expiradas',
        msg: 'Propostas expiradas pela rotina diária.',
        quantidade: expiradas.length,
      });
    }
  }
}
