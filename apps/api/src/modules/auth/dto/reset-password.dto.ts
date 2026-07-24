import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'Token inválido.' })
  @MinLength(1, { message: 'Token inválido.' })
  token: string;

  // Mesma política de senha do cadastro (RegisterDto): mínimo de 6 caracteres.
  @IsString({ message: 'Informe a senha.' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password: string;
}
