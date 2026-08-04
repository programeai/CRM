import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/** Editar cobrança — permitido apenas enquanto `PENDING` (ver PaymentsService.update). */
export class UpdatePaymentDto {
  @IsOptional()
  @IsString({ message: 'Descrição obrigatória.' })
  @MinLength(1, { message: 'Descrição obrigatória.' })
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0.01, { message: 'Valor inválido.' })
  amount?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Data de vencimento inválida.' })
  dueDate?: string;
}
