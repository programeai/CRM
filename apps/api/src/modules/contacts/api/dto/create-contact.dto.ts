import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateContactDto {
  @IsString({ message: 'O nome do contato é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;
  @IsOptional() @IsString({ message: 'Cargo inválido.' }) role?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) phone?: string;
  @IsOptional()
  @IsBoolean({
    message: 'O campo "contato principal" deve ser verdadeiro ou falso.',
  })
  isPrimary?: boolean;
}
