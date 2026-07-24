import { Controller, Get } from '@nestjs/common';
import { DashboardService } from '../application/dashboard.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary') summary(@CurrentUserId() ownerId: string) {
    return this.dashboard.summary(ownerId);
  }

  @Get('finance') finance(@CurrentUserId() ownerId: string) {
    return this.dashboard.finance(ownerId);
  }
}
