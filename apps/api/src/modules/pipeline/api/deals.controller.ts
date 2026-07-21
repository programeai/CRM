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
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { MoveDealDto } from './dto/move-deal.dto';

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListDealsQueryDto,
  ) {
    return this.deals.list(ownerId, query);
  }

  @Get('board') board(@CurrentUserId() ownerId: string) {
    return this.deals.board(ownerId);
  }

  @Post() create(@CurrentUserId() ownerId: string, @Body() dto: CreateDealDto) {
    return this.deals.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.deals.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
  ) {
    return this.deals.update(ownerId, id, dto);
  }

  @Patch(':id/move') move(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: MoveDealDto,
  ) {
    return this.deals.move(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.deals.delete(ownerId, id);
  }
}
