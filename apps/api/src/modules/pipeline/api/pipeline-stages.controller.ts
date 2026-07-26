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
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreatePipelineStageDto } from './dto/create-pipeline-stage.dto';
import { UpdatePipelineStageDto } from './dto/update-pipeline-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

/**
 * `PipelineStage` é um catálogo **global** da instância (sem `ownerId`, fora do
 * RLS): a leitura é livre para qualquer usuário logado, porque o quadro não
 * renderiza sem os estágios. As escritas exigem `oportunidade:gerenciar` — elas
 * afetam o pipeline de todos.
 */
@Controller('pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly stages: PipelineStagesService) {}

  @Get() list() {
    return this.stages.list();
  }

  @RequirePermission('oportunidade:gerenciar')
  @Post()
  create(@Body() dto: CreatePipelineStageDto) {
    return this.stages.create(dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch('reorder')
  reorder(@Body() dto: ReorderStagesDto) {
    return this.stages.reorder(dto.ids);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePipelineStageDto) {
    return this.stages.update(id, dto);
  }

  @RequirePermission('oportunidade:gerenciar')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stages.delete(id);
  }
}
