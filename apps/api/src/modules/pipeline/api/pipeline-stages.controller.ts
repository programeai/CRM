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
import { CreatePipelineStageDto } from './dto/create-pipeline-stage.dto';
import { UpdatePipelineStageDto } from './dto/update-pipeline-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

@Controller('pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly stages: PipelineStagesService) {}

  @Get() list() {
    return this.stages.list();
  }

  @Post() create(@Body() dto: CreatePipelineStageDto) {
    return this.stages.create(dto);
  }

  @Patch('reorder') reorder(@Body() dto: ReorderStagesDto) {
    return this.stages.reorder(dto.ids);
  }

  @Patch(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdatePipelineStageDto,
  ) {
    return this.stages.update(id, dto);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.stages.delete(id);
  }
}
