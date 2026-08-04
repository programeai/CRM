import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListDealsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;
  @IsOptional() @IsUUID('4', { message: 'Estágio inválido.' }) stageId?: string;
  @IsOptional() @IsString({ message: 'Busca inválida.' }) search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string;
}
