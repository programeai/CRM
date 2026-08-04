import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class PayPaymentDto {
  @IsOptional()
  @IsDateString({}, { message: 'Data do pagamento inválida.' })
  paidAt?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor recebido inválido.' })
  @Min(0, { message: 'Valor recebido inválido.' })
  paidAmount?: number;

  @IsEnum(PaymentMethod, { message: 'Forma de pagamento inválida.' })
  method: PaymentMethod;

  @IsOptional()
  @IsString({ message: 'Observações inválidas.' })
  notes?: string;
}
