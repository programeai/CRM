import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Atividade no histórico do cliente (contato feito, reunião, follow-up). É a
 * rota que serve o caso que originou a fase: um sistema de fora lançando evento
 * no histórico de um cliente. Sem `assigneeId`: a integração não conhece os
 * usuários da workspace.
 */
export class PublicCreateActivityDto {
  @ApiProperty({ format: 'uuid', description: 'Cliente da workspace.' })
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Item do catálogo de tipos de atividade do owner.',
  })
  @IsUUID('4', { message: 'Tipo de atividade inválido.' })
  typeId: string;

  @ApiProperty({ example: 'Cliente pediu proposta por telefone.' })
  @IsString({ message: 'O conteúdo é obrigatório.' })
  @MinLength(1, { message: 'O conteúdo é obrigatório.' })
  content: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Vincula a atividade a uma oportunidade do MESMO cliente.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Oportunidade inválida.' })
  dealId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Agenda a atividade: é o que a torna um follow-up pendente.',
    example: '2026-08-10T14:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Data agendada inválida.' })
  scheduledFor?: string;
}
