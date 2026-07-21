import { PartialType } from '@nestjs/mapped-types';
import { CreatePipelineStageDto } from './create-pipeline-stage.dto';

export class UpdatePipelineStageDto extends PartialType(
  CreatePipelineStageDto,
) {}
