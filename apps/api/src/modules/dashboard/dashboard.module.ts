import { Module } from '@nestjs/common';
import { DashboardController } from './api/dashboard.controller';
import { DashboardService } from './application/dashboard.service';
import { DASHBOARD_REPOSITORY } from './domain/dashboard.repository';
import { PrismaDashboardRepository } from './infra/prisma-dashboard.repository';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    { provide: DASHBOARD_REPOSITORY, useClass: PrismaDashboardRepository },
  ],
})
export class DashboardModule {}
