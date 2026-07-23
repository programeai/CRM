import { BillingType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateContractDto {
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Proposta inválida.' })
  proposalId?: string;

  @IsString()
  @MinLength(1, { message: 'Descrição obrigatória.' })
  description: string;

  @IsEnum(BillingType, { message: 'Regime inválido.' })
  billingType: BillingType;

  // RECURRING
  @ValidateIf((o: CreateContractDto) => o.billingType === 'RECURRING')
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor mensal inválido.' })
  @Min(0.01, { message: 'Valor mensal inválido.' })
  monthlyAmount?: number;

  @ValidateIf((o: CreateContractDto) => o.billingType === 'RECURRING')
  @IsInt()
  @Min(1, { message: 'Dia de vencimento entre 1 e 28.' })
  @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;

  @ValidateIf((o: CreateContractDto) => o.billingType === 'RECURRING')
  @IsDateString({}, { message: 'Data de início inválida.' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de término inválida.' })
  endDate?: string;

  // INSTALLMENTS
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da entrada inválido.' })
  @Min(0, { message: 'Valor da entrada inválido.' })
  downPayment?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Vencimento da entrada inválido.' })
  downPaymentDueDate?: string;

  @ValidateIf((o: CreateContractDto) => o.billingType === 'INSTALLMENTS')
  @IsInt()
  @Min(1, { message: 'Informe a quantidade de parcelas.' })
  installments?: number;

  @ValidateIf((o: CreateContractDto) => o.billingType === 'INSTALLMENTS')
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da parcela inválido.' })
  @Min(0.01, { message: 'Valor da parcela inválido.' })
  installmentAmount?: number;

  @ValidateIf((o: CreateContractDto) => o.billingType === 'INSTALLMENTS')
  @IsDateString({}, { message: 'Vencimento da 1ª parcela inválido.' })
  firstInstallmentDueDate?: string;

  // ONE_TIME
  @ValidateIf((o: CreateContractDto) => o.billingType === 'ONE_TIME')
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0.01, { message: 'Valor inválido.' })
  amount?: number;

  @ValidateIf((o: CreateContractDto) => o.billingType === 'ONE_TIME')
  @IsDateString({}, { message: 'Data de vencimento inválida.' })
  dueDate?: string;
}
