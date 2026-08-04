import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListProjectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;
  @IsOptional()
  @IsEnum(ProjectStatus, { message: 'Status inválido.' })
  status?: ProjectStatus;
  @IsOptional() @IsString({ message: 'Busca inválida.' }) search?: string;
}
