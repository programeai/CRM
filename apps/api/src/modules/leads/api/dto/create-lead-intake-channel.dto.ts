import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLeadIntakeChannelDto {
  @IsString({ message: 'O nome do canal é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(60, { message: 'O nome deve ter no máximo 60 caracteres.' })
  name: string;

  /** Responsável de todo lead deste canal. `null` = sem responsável. */
  @IsOptional()
  @IsUUID(undefined, { message: 'Responsável inválido.' })
  assigneeId?: string | null;

  /** Fonte de lead do catálogo do owner. `null` = não classifica. */
  @IsOptional()
  @IsUUID(undefined, { message: 'Fonte de lead inválida.' })
  sourceId?: string | null;
}
