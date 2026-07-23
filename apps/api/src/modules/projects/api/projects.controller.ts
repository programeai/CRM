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
import { ProjectsService } from '../application/projects.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projects.list(ownerId, query);
  }

  @Post() create(
    @CurrentUserId() ownerId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(ownerId, dto);
  }

  @Get(':id') findOne(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.projects.findOne(ownerId, id);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(ownerId, id, dto);
  }

  @Delete(':id') remove(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.projects.delete(ownerId, id);
  }
}
