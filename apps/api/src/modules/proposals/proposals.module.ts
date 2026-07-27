import { Module } from '@nestjs/common';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { ClientsModule } from '../clients/clients.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ProposalsController } from './api/proposals.controller';
import { ProposalsService } from './application/proposals.service';
import { ProposalsExpirationJob } from './application/proposals-expiration.job';
import { PROPOSAL_REPOSITORY } from './domain/proposal.repository';
import { PrismaProposalRepository } from './infra/prisma-proposal.repository';

@Module({
  imports: [ClientsModule, PipelineModule, CatalogosModule],
  controllers: [ProposalsController],
  providers: [
    ProposalsService,
    ProposalsExpirationJob,
    { provide: PROPOSAL_REPOSITORY, useClass: PrismaProposalRepository },
  ],
  exports: [ProposalsService],
})
export class ProposalsModule {}
