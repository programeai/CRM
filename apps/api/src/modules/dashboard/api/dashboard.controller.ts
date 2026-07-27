import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from '../application/dashboard.service';
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { FinanceQueryDto } from './dto/finance-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * Sem `@RequirePermission`: o dashboard é a home de todo colaborador. Cada
   * bloco, porém, é agregado de um módulo diferente — o service recorta pelas
   * permissões da sessão e devolve `null` no que não é permitido.
   */
  @Get('summary') summary(
    @CurrentOwnerId() ownerId: string,
    @CurrentAccess() access: AccessContext,
    @Query() query: SummaryQueryDto,
  ) {
    return this.dashboard.summary(ownerId, access, query.onlyMine ?? false);
  }

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get('finance')
  finance(@CurrentOwnerId() ownerId: string, @Query() query: FinanceQueryDto) {
    return this.dashboard.finance(ownerId, query.month);
  }
}
