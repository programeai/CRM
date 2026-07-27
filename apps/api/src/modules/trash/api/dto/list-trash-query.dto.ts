import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';
import type { TrashType } from '../../domain/trash.repository';

const TRASH_TYPES: readonly TrashType[] = [
  'CLIENT',
  'CONTACT',
  'DEAL',
  'PROJECT',
  'TASK',
];

export class ListTrashQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TRASH_TYPES, { message: 'Tipo de registro inválido.' })
  type?: TrashType;
}
