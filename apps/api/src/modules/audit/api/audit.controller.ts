import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Query,
} from '@nestjs/common';
import { AuditEntity } from '@prisma/client';
import { AuditQueryService } from '../application/audit-query.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

@Controller('audit')
// Uma chave só: quem pode ver a trilha vê tudo dela. A trilha não é editável.
@RequirePermission('auditoria:ver')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListAuditQueryDto) {
    return this.audit.list(ownerId, query);
  }

  /** Histórico de um registro específico — alimenta o diálogo "Histórico". */
  @Get('entities/:entity/:id')
  byEntity(
    @CurrentOwnerId() ownerId: string,
    // `exceptionFactory`: a mensagem padrão do ParseEnumPipe é em inglês.
    @Param(
      'entity',
      new ParseEnumPipe(AuditEntity, {
        exceptionFactory: () =>
          new BadRequestException('Tipo de registro inválido.'),
      }),
    )
    entity: AuditEntity,
    @Param('id') id: string,
  ) {
    return this.audit.byEntity(ownerId, entity, id);
  }
}
