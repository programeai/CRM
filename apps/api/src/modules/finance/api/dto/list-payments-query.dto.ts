import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BillingType, PaymentStatus } from '@prisma/client';
import {
  PAYMENT_SORT_FIELDS,
  type PaymentSortField,
  type SortDirection,
} from '../../domain/payment.repository';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Contrato inválido.' })
  contractId?: string;

  /**
   * Aceita um único status (`?status=PAID`) ou vários (`?status[]=PENDING&status[]=OVERDUE`),
   * normalizados para array. Usado pelos cards de resumo (ex.: "A receber" = PENDING + OVERDUE).
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @IsEnum(PaymentStatus, { each: true, message: 'Status inválido.' })
  status?: PaymentStatus[];

  @IsOptional()
  @IsEnum(BillingType, { message: 'Regime inválido.' })
  billingType?: BillingType;

  @IsOptional()
  @IsDateString({}, { message: 'Data inicial inválida.' })
  dueFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data final inválida.' })
  dueTo?: string;

  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS, { message: 'Ordenação inválida.' })
  sortBy?: PaymentSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'Direção de ordenação inválida.' })
  sortDir?: SortDirection;
}
