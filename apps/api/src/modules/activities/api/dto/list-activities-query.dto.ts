import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListActivitiesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;
  @IsOptional() @IsUUID('4', { message: 'Negócio inválido.' }) dealId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string;
}
