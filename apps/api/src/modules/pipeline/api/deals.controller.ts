import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DealsService } from '../application/deals.service';
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { resolveAssigneeScope } from '../../../shared/record-scope';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { MoveDealDto } from './dto/move-deal.dto';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get()
  list(
    @CurrentAccess() access: AccessContext,
    @Query() query: ListDealsQueryDto,
  ) {
    return this.deals.list(
      access.ownerId,
      query,
      resolveAssigneeScope(access, 'oportunidade:ver_todas'),
    );
  }

  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get('board')
  board(
    @CurrentAccess() access: AccessContext,
    @Query() query: ListDealsQueryDto,
  ) {
    return this.deals.board(
      access.ownerId,
      resolveAssigneeScope(access, 'oportunidade:ver_todas'),
      query.assigneeId,
      // O `nextActivityAt` do card é dado de ATIVIDADE: recorta pela chave de
      // cliente, não pela de oportunidade.
      resolveAssigneeScope(access, 'cliente:ver_todos'),
    );
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateDealDto) {
    return this.deals.create(ownerId, dto);
  }

  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get(':id')
  findOne(@CurrentAccess() access: AccessContext, @Param('id') id: string) {
    return this.deals.findOne(
      access.ownerId,
      id,
      resolveAssigneeScope(access, 'oportunidade:ver_todas'),
    );
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.deals.update(ownerId, id, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch(':id/move')
  move(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: MoveDealDto,
  ) {
    return this.deals.move(ownerId, id, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post(':id/archive')
  archive(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.archive(ownerId, id);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post(':id/restore')
  restore(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.restore(ownerId, id);
  }

  /**
   * Expurgo — destrutivo e irreversível. A chave é `lixeira:expurgar`, não a do
   * módulo: quem gerencia oportunidades pode arquivar, mas apagar de vez é uma
   * decisão de governança.
   */
  @RequirePermission('lixeira:expurgar')
  @Delete(':id')
  purge(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.purge(ownerId, id);
  }
}
