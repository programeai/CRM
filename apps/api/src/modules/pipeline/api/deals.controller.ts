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
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
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
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListDealsQueryDto) {
    return this.deals.list(ownerId, query);
  }

  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get('board')
  board(@CurrentOwnerId() ownerId: string) {
    return this.deals.board(ownerId);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateDealDto) {
    return this.deals.create(ownerId, dto);
  }

  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get(':id')
  findOne(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.findOne(ownerId, id);
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
  @Delete(':id')
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.deals.delete(ownerId, id);
  }
}
