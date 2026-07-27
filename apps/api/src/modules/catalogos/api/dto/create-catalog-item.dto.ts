import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCatalogItemDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(60, { message: 'O nome deve ter no máximo 60 caracteres.' })
  name: string;

  /** Só aceito em `tipos-de-atividade`; nos outros o service responde 422. */
  @IsOptional() @IsBoolean() isFollowUp?: boolean;
}
