import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProposalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListProposalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
  @IsOptional()
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId?: string;
  @IsOptional()
  @IsEnum(ProposalStatus, { message: 'Status inválido.' })
  status?: ProposalStatus;
}
