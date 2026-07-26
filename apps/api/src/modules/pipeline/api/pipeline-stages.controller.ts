import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PipelineStagesService } from '../application/pipeline-stages.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreatePipelineStageDto } from './dto/create-pipeline-stage.dto';
import { UpdatePipelineStageDto } from './dto/update-pipeline-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

/**
 * O funil é **do owner**: cada workspace tem os seus estágios (`ownerId` + RLS),
 * criados junto com a conta e configuráveis sem afetar ninguém. Configurar o
 * funil é gerir o pipeline, então as escritas exigem `oportunidade:gerenciar`.
 */
@Controller('pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly stages: PipelineStagesService) {}

  @RequirePermission('oportunidade:ver', 'oportunidade:gerenciar')
  @Get()
  list(@CurrentOwnerId() ownerId: string) {
    return this.stages.list(ownerId);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post()
  create(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: CreatePipelineStageDto,
  ) {
    return this.stages.create(ownerId, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch('reorder')
  reorder(@CurrentOwnerId() ownerId: string, @Body() dto: ReorderStagesDto) {
    return this.stages.reorder(ownerId, dto.ids);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePipelineStageDto,
  ) {
    return this.stages.update(ownerId, id, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Delete(':id')
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.stages.delete(ownerId, id);
  }
}
