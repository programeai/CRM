import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ActivitiesService } from '../application/activities.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activities.list(ownerId, query);
  }

  @Post()
  create(@CurrentUserId() ownerId: string, @Body() dto: CreateActivityDto) {
    return this.activities.create(ownerId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(ownerId, id, dto);
  }

  @Post(':id/complete')
  complete(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.activities.complete(ownerId, id);
  }
}
