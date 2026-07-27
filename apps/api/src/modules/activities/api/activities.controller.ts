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
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { resolveAssigneeScope } from '../../../shared/record-scope';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get()
  list(
    @CurrentAccess() access: AccessContext,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activities.list(
      access.ownerId,
      query,
      resolveAssigneeScope(access, 'cliente:ver_todos'),
    );
  }

  @RequirePermission('cliente:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateActivityDto) {
    return this.activities.create(ownerId, dto);
  }

  @RequirePermission('cliente:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(ownerId, id, dto);
  }

  @RequirePermission('cliente:gerenciar')
  @Post(':id/complete')
  complete(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.activities.complete(ownerId, id);
  }
}
