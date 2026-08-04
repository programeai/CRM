import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Confirmação do encerramento. Os dois campos são opcionais no DTO e
 * mutuamente exclusivos na regra: qual deles vale depende de a conta ter senha
 * (ver `AccountDeletionService.assertReautenticado`). Validar aqui qual é o
 * exigido vazaria, na mensagem de erro, se aquele e-mail tem senha ou é só-OAuth.
 */
export class RequestDeletionDto {
  @IsOptional()
  @IsString({ message: 'Senha inválida.' })
  @MaxLength(200, { message: 'A senha informada é longa demais.' })
  password?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;
}
