import {
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  IsDateString,
} from 'class-validator';

export class CreateActivityDto {
  @IsUUID('4', { message: 'Cliente inválido.' }) clientId: string;
  @IsOptional()
  @IsUUID('4', { message: 'Oportunidade inválida.' })
  dealId?: string;
  @IsUUID('4', { message: 'Tipo de atividade inválido.' })
  typeId: string;
  @IsString({ message: 'O conteúdo é obrigatório.' })
  @MinLength(1, { message: 'O conteúdo é obrigatório.' })
  content: string;
  @IsOptional()
  @IsDateString({}, { message: 'Data agendada inválida.' })
  scheduledFor?: string;

  /**
   * Responsável. `null` limpa o campo; ausente preserva. `@IsOptional()` do
   * class-validator ignora `null` **e** `undefined`, então o `@IsUUID` só roda
   * quando vem um valor de verdade.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string | null;
}
