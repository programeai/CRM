import { IsString, Matches } from 'class-validator';

export class Confirm2faDto {
  @IsString({ message: 'Informe o código do app autenticador.' })
  @Matches(/^\d{6}$/, {
    message: 'O código tem 6 dígitos, só números.',
  })
  codigo: string;
}
