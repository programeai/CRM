import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Parcial e restrito: não permite trocar `clientId`, `billingType` nem os
 * campos de INSTALLMENTS já materializados em cobranças. Reajuste de
 * `monthlyAmount` vale só para as mensalidades ainda não geradas.
 */
export class UpdateContractDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Descrição obrigatória.' })
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor mensal inválido.' })
  @Min(0.01, { message: 'Valor mensal inválido.' })
  monthlyAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Dia de vencimento entre 1 e 28.' })
  @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Data de término inválida.' })
  endDate?: string;
}
