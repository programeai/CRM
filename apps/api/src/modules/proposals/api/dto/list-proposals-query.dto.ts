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
  /** Propostas de uma oportunidade — alimenta o detalhe dela no funil. */
  @IsOptional()
  @IsUUID('4', { message: 'Oportunidade inválida.' })
  dealId?: string;
  @IsOptional()
  @IsEnum(ProposalStatus, { message: 'Status inválido.' })
  status?: ProposalStatus;
}
