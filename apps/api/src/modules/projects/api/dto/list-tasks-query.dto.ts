import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListTasksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId?: string;
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;
  @IsOptional()
  @IsEnum(TaskStatus, { message: 'Status inválido.' })
  status?: TaskStatus;
  @IsOptional()
  @IsEnum(TaskPriority, { message: 'Prioridade inválida.' })
  priority?: TaskPriority;
  @IsOptional()
  @IsDateString({}, { message: 'Data inválida.' })
  dueBefore?: string;
}
