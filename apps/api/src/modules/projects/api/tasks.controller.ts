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
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
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
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListTasksQueryDto) {
    return this.tasks.list(ownerId, query);
  }

  @RequirePermission('projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar')
  @Get('board')
  board(
    @CurrentOwnerId() ownerId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.tasks.board(ownerId, projectId);
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
  findOne(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.tasks.findOne(ownerId, id);
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
  @Delete(':id')
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.tasks.delete(ownerId, id);
  }
}
