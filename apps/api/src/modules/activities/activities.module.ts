import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { ActivitiesController } from './api/activities.controller';
import { ActivitiesService } from './application/activities.service';
import { ACTIVITY_REPOSITORY } from './domain/activity.repository';
import { PrismaActivityRepository } from './infra/prisma-activity.repository';

@Module({
  imports: [ClientsModule, WorkspaceModule, CatalogosModule],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    { provide: ACTIVITY_REPOSITORY, useClass: PrismaActivityRepository },
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
