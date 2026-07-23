import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { ChecklistItemDto } from './checklist-item.dto';

export class CreateTaskDto {
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId: string;

  @IsString({ message: 'O título é obrigatório.' })
  @MinLength(2, { message: 'O título deve ter no mínimo 2 caracteres.' })
  title: string;

  @IsOptional() @IsString() description?: string;

  @IsOptional()
  @IsEnum(TaskStatus, { message: 'Status inválido.' })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority, { message: 'Prioridade inválida.' })
  priority?: TaskPriority;

  @IsOptional()
  @IsDateString({}, { message: 'Prazo inválido.' })
  dueDate?: string;

  @IsOptional()
  @IsArray({ message: 'Tags inválidas.' })
  @IsString({ each: true, message: 'Tag inválida.' })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}
