import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ClientStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListClientsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Status inválido.' })
  status?: ClientStatus;
  @IsOptional()
  @IsUUID('4', { message: 'Origem inválida.' })
  sourceId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string;
}
