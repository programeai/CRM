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
import { TasksService } from '../application/tasks.service';
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { resolveAssigneeScope } from '../../../shared/record-scope';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { MoveTaskDto } from './dto/move-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @RequirePermission('projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar')
  @Get()
  list(
    @CurrentAccess() access: AccessContext,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasks.list(
      access.ownerId,
      query,
      resolveAssigneeScope(access, 'demanda:ver_todas'),
    );
  }

  @RequirePermission('projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar')
  @Get('board')
  board(
    @CurrentAccess() access: AccessContext,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasks.board(
      access.ownerId,
      query.projectId,
      resolveAssigneeScope(access, 'demanda:ver_todas'),
      query.assigneeId,
    );
  }

  // Rotas de tags declaradas antes de `:id` para não serem capturadas por ele.
  @RequirePermission('projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar')
  @Get('tags')
  listTags(@CurrentOwnerId() ownerId: string) {
    return this.tasks.listTags(ownerId);
  }

  @RequirePermission('projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar')
  @Get('tags/usage')
  tagUsage(@CurrentOwnerId() ownerId: string, @Query('tag') tag: string) {
    return this.tasks.tagUsage(ownerId, tag);
  }

  @RequirePermission('demanda:gerenciar')
  @Delete('tags')
  deleteTag(@CurrentOwnerId() ownerId: string, @Query('tag') tag: string) {
    return this.tasks.deleteTag(ownerId, tag);
  }

  @RequirePermission('demanda:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.create(ownerId, dto);
  }

  @RequirePermission('projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar')
  @Get(':id')
  findOne(@CurrentAccess() access: AccessContext, @Param('id') id: string) {
    return this.tasks.findOne(
      access.ownerId,
      id,
      resolveAssigneeScope(access, 'demanda:ver_todas'),
    );
  }

  @RequirePermission('demanda:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(ownerId, id, dto);
  }

  @RequirePermission('demanda:gerenciar')
  @Patch(':id/move')
  move(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: MoveTaskDto,
  ) {
    return this.tasks.move(ownerId, id, dto);
  }

  @RequirePermission('demanda:gerenciar')
  @Post(':id/archive')
  archive(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.tasks.archive(ownerId, id);
  }

  @RequirePermission('demanda:gerenciar')
  @Post(':id/restore')
  restore(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.tasks.restore(ownerId, id);
  }

  /**
   * Expurgo — destrutivo e irreversível. A chave é `lixeira:expurgar`, não a do
   * módulo: quem gerencia demandas pode arquivar, mas apagar de vez é uma
   * decisão de governança.
   */
  @RequirePermission('lixeira:expurgar')
  @Delete(':id')
  purge(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.tasks.purge(ownerId, id);
  }
}
