import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  IsDateString,
} from 'class-validator';
import { ActivityType } from '@prisma/client';

export class CreateActivityDto {
  @IsUUID('4', { message: 'Cliente inválido.' }) clientId: string;
  @IsOptional() @IsUUID('4') dealId?: string;
  @IsEnum(ActivityType, { message: 'Tipo de atividade inválido.' })
  type: ActivityType;
  @IsString({ message: 'O conteúdo é obrigatório.' })
  @MinLength(1, { message: 'O conteúdo é obrigatório.' })
  content: string;
  @IsOptional()
  @IsDateString({}, { message: 'Data agendada inválida.' })
  scheduledFor?: string;
}
