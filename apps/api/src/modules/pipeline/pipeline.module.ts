import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { PipelineStagesController } from './api/pipeline-stages.controller';
import { PipelineStagesService } from './application/pipeline-stages.service';
import { PIPELINE_STAGE_REPOSITORY } from './domain/pipeline-stage.repository';
import { PrismaPipelineStageRepository } from './infra/prisma-pipeline-stage.repository';
import { DealsController } from './api/deals.controller';
import { DealsService } from './application/deals.service';
import { DEAL_REPOSITORY } from './domain/deal.repository';
import { PrismaDealRepository } from './infra/prisma-deal.repository';

@Module({
  imports: [ClientsModule, ProjectsModule, WorkspaceModule, CatalogosModule],
  controllers: [PipelineStagesController, DealsController],
  providers: [
    PipelineStagesService,
    DealsService,
    {
      provide: PIPELINE_STAGE_REPOSITORY,
      useClass: PrismaPipelineStageRepository,
    },
    { provide: DEAL_REPOSITORY, useClass: PrismaDealRepository },
  ],
  exports: [PipelineStagesService, DealsService],
})
export class PipelineModule {}
