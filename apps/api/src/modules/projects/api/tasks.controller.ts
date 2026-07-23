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
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { MoveTaskDto } from './dto/move-task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasks.list(ownerId, query);
  }

  @Get('board') board(
    @CurrentUserId() ownerId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.tasks.board(ownerId, projectId);
  }

  @Post() create(@CurrentUserId() ownerId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.tasks.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(ownerId, id, dto);
  }

  @Patch(':id/move') move(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: MoveTaskDto,
  ) {
    return this.tasks.move(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.tasks.delete(ownerId, id);
  }
}
