import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BillingType, ContractStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListContractsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;

  @IsOptional()
  @IsEnum(ContractStatus, { message: 'Status inválido.' })
  status?: ContractStatus;

  @IsOptional()
  @IsEnum(BillingType, { message: 'Regime inválido.' })
  billingType?: BillingType;
}
