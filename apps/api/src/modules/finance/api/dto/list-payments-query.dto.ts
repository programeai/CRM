import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BillingType, PaymentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Contrato inválido.' })
  contractId?: string;

  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'Status inválido.' })
  status?: PaymentStatus;

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
