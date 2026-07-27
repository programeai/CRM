import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PROPOSAL_REPOSITORY,
  type ProposalRepository,
} from '../domain/proposal.repository';
import { AuditService } from '../../audit/audit.service';

/** Nome exibido na tela de auditoria para as rotinas diárias. */
const ATOR_ROTINA = 'Rotina diária';

@Injectable()
export class ProposalsExpirationJob {
  private readonly logger = new Logger(ProposalsExpirationJob.name);

  constructor(
    @Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
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
