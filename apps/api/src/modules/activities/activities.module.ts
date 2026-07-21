import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ActivitiesController } from './api/activities.controller';
import { ActivitiesService } from './application/activities.service';
import { ACTIVITY_REPOSITORY } from './domain/activity.repository';
import { PrismaActivityRepository } from './infra/prisma-activity.repository';

@Module({
  imports: [ClientsModule],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    { provide: ACTIVITY_REPOSITORY, useClass: PrismaActivityRepository },
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
