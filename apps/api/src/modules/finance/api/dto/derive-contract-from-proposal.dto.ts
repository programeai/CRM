import { Type } from 'class-transformer';
import { BillingType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Plano enviado pela tela de conferência. Duplica os campos de plano de
 * `CreateProposalDto` de propósito: um módulo não importa o interior de outro
 * (`apps/api/CLAUDE.md`), e é a mesma razão pela qual
 * `finance/application/money.ts` é uma cópia do de `proposals`. O que NÃO é
 * duplicado é a regra: `assertPlanoCoerente` vive em `shared/billing-plan.ts`
 * e é chamada pelos dois lados.
 *
 * Todos opcionais: o `@ValidateIf` por regime não cabe aqui (o plano é um
 * objeto aninhado e o regime vive nele), então a coerência é 100% do
 * `assertPlanoCoerente` no service.
 */
export class BillingPlanDto {
  @IsEnum(BillingType, { message: 'Regime de cobrança inválido.' })
  billingType: BillingType;

  @IsInt({ message: 'Prazo em dias inválido.' })
  @Min(0, { message: 'O prazo não pode ser negativo.' })
  @Max(365, { message: 'O prazo deve ser de no máximo 365 dias.' })
  startOffsetDays: number;

  @IsOptional()
  @IsInt({ message: 'Dia de vencimento entre 1 e 28.' })
  @Min(1, { message: 'Dia de vencimento entre 1 e 28.' })
  @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;

  @IsOptional()
  @IsInt({ message: 'Duração em meses inválida.' })
  @Min(1, { message: 'A duração deve ser de pelo menos 1 mês.' })
  @Max(120, { message: 'A duração deve ser de no máximo 120 meses.' })
  durationMonths?: number;

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

  @IsOptional()
  @IsInt({ message: 'Informe a quantidade de parcelas.' })
  @Min(1, { message: 'Informe a quantidade de parcelas.' })
  @Max(120, { message: 'No máximo 120 parcelas.' })
  installments?: number;
}

/**
 * Corpo das duas rotas de derivação. Tudo opcional: body vazio = "use o plano
 * gravado na proposta e a descrição padrão".
 *
 * O que se envia é o PLANO, não os campos do contrato. Assim o rateio de
 * centavos e o valor da última parcela nunca atravessam a rede — a matemática
 * de dinheiro vive só no backend, como o `total` da proposta.
 */
export class DeriveContractFromProposalDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Descrição obrigatória.' })
  description?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Projeto inválido.' })
  projectId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingPlanDto)
  plano?: BillingPlanDto;
}
