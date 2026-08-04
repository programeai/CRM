import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * O segundo passo do login. `codigo` aceita **os dois** formatos — os 6 dígitos
 * do autenticador e um código de recuperação (`A1B2C3D4-E5F6G7H8`) —, e é por
 * isso que a validação é de tamanho e não de formato: separar em dois campos
 * obrigaria a tela a perguntar "que tipo de código é esse?" antes de enviar, o
 * que quem está travado na porta não quer responder.
 */
export class Login2faDto {
  @IsString({
    message: 'Confirmação inválida. Entre com e-mail e senha de novo.',
  })
  @MinLength(10, {
    message: 'Confirmação inválida. Entre com e-mail e senha de novo.',
  })
  desafio: string;

  @IsString({ message: 'Informe o código.' })
  @MinLength(6, {
    message: 'O código tem 6 dígitos, ou é um código de recuperação.',
  })
  @MaxLength(40, { message: 'Código inválido.' })
  codigo: string;
}
