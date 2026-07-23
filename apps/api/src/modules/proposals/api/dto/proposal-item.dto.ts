import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class ProposalItemDto {
  @IsString({ message: 'A descrição do item é obrigatória.' })
  @MinLength(1, { message: 'A descrição do item é obrigatória.' })
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Quantidade inválida.' })
  @Min(0, { message: 'A quantidade não pode ser negativa.' })
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor unitário inválido.' })
  @Min(0, { message: 'O valor unitário não pode ser negativo.' })
  unitPrice: number;
}
