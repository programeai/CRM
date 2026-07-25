import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PROPOSAL_REPOSITORY,
  type ProposalRepository,
} from '../domain/proposal.repository';

@Injectable()
export class ProposalsExpirationJob {
  private readonly logger = new Logger(ProposalsExpirationJob.name);

  constructor(
    @Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const count = await this.repo.expireOverdue(new Date());
    if (count > 0) {
      this.logger.log({
        evento: 'propostas.expiradas',
        msg: 'Propostas expiradas pela rotina diária.',
        quantidade: count,
      });
    }
  }
}
