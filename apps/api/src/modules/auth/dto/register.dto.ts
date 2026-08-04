import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString({ message: 'Informe o nome.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name: string;

  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;

  @IsString({ message: 'Informe a senha.' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password: string;

  // Token do captcha (Turnstile). Opcional aqui; a obrigatoriedade quando o
  // captcha está habilitado é aplicada no CaptchaService.
  @IsOptional()
  @IsString({ message: 'Token do captcha inválido.' })
  captchaToken?: string;
}
