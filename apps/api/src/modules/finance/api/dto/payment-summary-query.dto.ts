import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BillingType } from '@prisma/client';

/** Filtros do resumo de recebimentos (mesmos da listagem, exceto paginação e status). */
export class PaymentSummaryQueryDto {
  @IsOptional() @IsString({ message: 'Busca inválida.' }) search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Contrato inválido.' })
  contractId?: string;

  @IsOptional()
  @IsEnum(BillingType, { message: 'Regime inválido.' })
  billingType?: BillingType;

  @IsOptional()
  @IsDateString({}, { message: 'Data inicial inválida.' })
  dueFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data final inválida.' })
  dueTo?: string;
}
