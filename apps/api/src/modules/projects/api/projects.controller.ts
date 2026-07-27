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
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @RequirePermission('projeto:ver', 'projeto:gerenciar')
  @Get()
  list(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projects.list(ownerId, query);
  }

  @RequirePermission('projeto:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateProjectDto) {
    return this.projects.create(ownerId, dto);
  }

  @RequirePermission('projeto:ver', 'projeto:gerenciar')
  @Get(':id')
  findOne(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.projects.findOne(ownerId, id);
  }

  @RequirePermission('projeto:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(ownerId, id, dto);
  }

  @RequirePermission('projeto:gerenciar')
  @Post(':id/archive')
  archive(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.projects.archive(ownerId, id);
  }

  @RequirePermission('projeto:gerenciar')
  @Post(':id/restore')
  restore(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.projects.restore(ownerId, id);
  }

  /**
   * Expurgo — destrutivo e irreversível. A chave é `lixeira:expurgar`, não a do
   * módulo: quem gerencia projetos pode arquivar, mas apagar de vez é uma
   * decisão de governança.
   */
  @RequirePermission('lixeira:expurgar')
  @Delete(':id')
  purge(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.projects.purge(ownerId, id);
  }
}
