import { Type } from 'class-transformer';
import { BillingType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ProposalItemDto } from './proposal-item.dto';

export class CreateProposalDto {
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Oportunidade inválida.' })
  dealId?: string;

  @IsUUID('4', { message: 'Tipo de serviço inválido.' })
  serviceTypeId: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Informe ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items: ProposalItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Desconto inválido.' })
  @Min(0, { message: 'O desconto não pode ser negativo.' })
  discount?: number;

  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() deliveryTime?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de validade inválida.' })
  validUntil?: string;

  // --- plano de cobrança ---------------------------------------------------
  // Obrigatório na criação (a coluna é nullable só pelo histórico). Campos
  // condicionais no molde de `CreateContractDto`: `@ValidateIf` olhando o
  // `billingType`. A coerência do CONJUNTO é do service — ver
  // `assertPlanoCoerente` em shared/billing-plan.ts e o porquê.
  @IsEnum(BillingType, { message: 'Regime de cobrança inválido.' })
  billingType: BillingType;

  @IsInt({ message: 'Prazo em dias inválido.' })
  @Min(0, { message: 'O prazo não pode ser negativo.' })
  @Max(365, { message: 'O prazo deve ser de no máximo 365 dias.' })
  startOffsetDays: number;

  // RECURRING
  @ValidateIf((o: CreateProposalDto) => o.billingType === 'RECURRING')
  @IsInt({ message: 'Dia de vencimento entre 1 e 28.' })
  @Min(1, { message: 'Dia de vencimento entre 1 e 28.' })
  @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;

  @IsOptional()
  @IsInt({ message: 'Duração em meses inválida.' })
  @Min(1, { message: 'A duração deve ser de pelo menos 1 mês.' })
  @Max(120, { message: 'A duração deve ser de no máximo 120 meses.' })
  durationMonths?: number;

  // INSTALLMENTS
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Entrada em percentual inválida.' },
  )
  @Min(0.01, {
    message: 'A entrada em percentual deve estar entre 0,01 e 100.',
  })
  @Max(100, { message: 'A entrada em percentual deve estar entre 0,01 e 100.' })
  downPaymentPercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da entrada inválido.' })
  @Min(0.01, { message: 'Valor da entrada inválido.' })
  downPaymentAmount?: number;

  @IsOptional()
  @IsInt({ message: 'Prazo da entrada inválido.' })
  @Min(0, { message: 'O prazo da entrada não pode ser negativo.' })
  @Max(365, { message: 'O prazo da entrada deve ser de no máximo 365 dias.' })
  downPaymentOffsetDays?: number;

  @ValidateIf((o: CreateProposalDto) => o.billingType === 'INSTALLMENTS')
  @IsInt({ message: 'Informe a quantidade de parcelas.' })
  @Min(1, { message: 'Informe a quantidade de parcelas.' })
  @Max(120, { message: 'No máximo 120 parcelas.' })
  installments?: number;
}
