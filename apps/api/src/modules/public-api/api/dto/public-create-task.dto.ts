import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority, TaskStatus } from '@prisma/client';

/**
 * Demanda no quadro de um projeto existente. Sem `checklist` (estrutura
 * aninhada, que é contrato de UI e mudaria mais que o resto) e sem `assigneeId`:
 * a integração não conhece os usuários da workspace.
 */
export class PublicCreateTaskDto {
  @ApiProperty({ format: 'uuid', description: 'Projeto da workspace.' })
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId: string;

  @ApiProperty({ example: 'Publicar a homepage', minLength: 2 })
  @IsString({ message: 'O título é obrigatório.' })
  @MinLength(2, { message: 'O título deve ter no mínimo 2 caracteres.' })
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Descrição inválida.' })
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus, default: TaskStatus.BACKLOG })
  @IsOptional()
  @IsEnum(TaskStatus, { message: 'Status inválido.' })
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TaskPriority, { message: 'Prioridade inválida.' })
  priority?: TaskPriority;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-08-20T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Prazo inválido.' })
  dueDate?: string;

  @ApiPropertyOptional({ type: [String], example: ['frontend'] })
  @IsOptional()
  @IsArray({ message: 'Tags inválidas.' })
  @IsString({ each: true, message: 'Tag inválida.' })
  tags?: string[];
}
