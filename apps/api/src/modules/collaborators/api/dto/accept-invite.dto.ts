import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  /** Mesmo mínimo do cadastro e da redefinição de senha (RegisterDto). */
  @IsString({ message: 'Informe uma senha.' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password: string;
}
