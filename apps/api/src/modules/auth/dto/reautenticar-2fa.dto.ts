import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Reautenticação para mexer no próprio segundo fator (OWASP ASVS 3.7.1): a senha
 * **ou** um código válido do autenticador. Ao menos um dos dois — a checagem do
 * "ao menos um" fica no service, porque a resposta certa ali é
 * `ForbiddenException`, não erro de validação (ver o docblock de
 * `AuthService.desativarSegundoFator`).
 *
 * Quem entrou por login social e nunca definiu senha usa o `codigo`: é o caminho
 * que existe para ele.
 */
export class Reautenticar2faDto {
  @IsOptional()
  @IsString({ message: 'Senha inválida.' })
  @MaxLength(200, { message: 'Senha inválida.' })
  password?: string;

  @IsOptional()
  @IsString({ message: 'Código inválido.' })
  @MinLength(6, { message: 'Código inválido.' })
  @MaxLength(40, { message: 'Código inválido.' })
  codigo?: string;
}
