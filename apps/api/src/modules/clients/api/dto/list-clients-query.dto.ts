import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ClientStatus, LeadSource } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListClientsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Status inválido.' })
  status?: ClientStatus;
  @IsOptional()
  @IsEnum(LeadSource, { message: 'Origem inválida.' })
  source?: LeadSource;

  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string;
}
