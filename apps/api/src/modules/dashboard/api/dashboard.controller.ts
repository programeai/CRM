import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from '../application/dashboard.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { FinanceQueryDto } from './dto/finance-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary') summary(@CurrentUserId() ownerId: string) {
    return this.dashboard.summary(ownerId);
  }

  @Get('finance') finance(
    @CurrentUserId() ownerId: string,
    @Query() query: FinanceQueryDto,
  ) {
    return this.dashboard.finance(ownerId, query.month);
  }
}
