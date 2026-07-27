import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AuditAction, AuditEntity } from '@prisma/client';
import { PaginationQueryDto } from '../../../../shared/dto/pagination-query.dto';

export class ListAuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AuditEntity, { message: 'Tipo de registro inválido.' })
  entity?: AuditEntity;

  @IsOptional()
  @IsUUID('4', { message: 'Registro inválido.' })
  entityId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Autor inválido.' })
  actorId?: string;

  @IsOptional()
  @IsEnum(AuditAction, { message: 'Ação inválida.' })
  action?: AuditAction;

  @IsOptional()
  @IsDateString({}, { message: 'Data inicial inválida.' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data final inválida.' })
  to?: string;
}
