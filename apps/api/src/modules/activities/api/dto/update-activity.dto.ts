import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateActivityDto } from './create-activity.dto';

// Não se move uma atividade de cliente: omitimos clientId da atualização.
export class UpdateActivityDto extends PartialType(
  OmitType(CreateActivityDto, ['clientId'] as const),
) {}
