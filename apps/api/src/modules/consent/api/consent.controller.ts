import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { ConsentService } from '../application/consent.service';
import {
  CONSENT_PURPOSES,
  type ConsentPurpose,
} from '../domain/consent-purpose';
import { CreateConsentDto } from './dto/create-consent.dto';
import { ListConsentQueryDto } from './dto/list-consent-query.dto';
import { TextoDeConsentimentoQueryDto } from './dto/texto-de-consentimento-query.dto';

/**
 * `@Controller('consentimentos')`, e não uma sub-rota de `/clients/:id`: o titular
 * pode ser `Client` **ou** `Contact`, e duplicar as rotas nos dois controllers
 * duplicaria a regra. O recorte vem da query.
 *
 * Permissões: reusa `cliente:ver` e `cliente:gerenciar`. Consentimento é parte do
 * cadastro do titular — quem gerencia o cliente registra o consentimento dele. Uma
 * chave nova significaria "papel que só mexe em consentimento", que não é um
 * conceito do produto.
 */
@Controller('consentimentos')
export class ConsentController {
  constructor(private readonly service: ConsentService) {}

  /** Catálogo de finalidades — o front consome os rótulos daqui, não os duplica. */
  @Get('finalidades')
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  finalidades() {
    return CONSENT_PURPOSES;
  }

  /**
   * O texto vigente de uma finalidade, com o nome e o contato do **owner** (que é
   * o controlador desses dados) preenchidos. A tela exibe antes de registrar: é o
   * que faz o consentimento ser informado, e é a versão deste texto que fica
   * gravada na linha.
   */
  @Get('texto')
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  texto(
    @CurrentOwnerId() ownerId: string,
    @Query() query: TextoDeConsentimentoQueryDto,
  ) {
    return this.service.texto(ownerId, query.purpose as ConsentPurpose);
  }

  /** Histórico completo + a situação vigente por finalidade. */
  @Get()
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  historico(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ListConsentQueryDto,
  ) {
    return this.service.historico(ownerId, query.subjectType, query.subjectId);
  }

  /**
   * Registra manifestação. **Revogar é chamar isto com `granted: false`** — não há
   * `PATCH` nem `DELETE`, e não é omissão: a tabela é append-only no banco, porque
   * o art. 8º § 5º manda preservar "ratificados os tratamentos realizados sob
   * amparo do consentimento anteriormente manifestado".
   */
  @Post()
  @RequirePermission('cliente:gerenciar')
  registrar(
    @CurrentOwnerId() ownerId: string,
    @CurrentAccess() access: AccessContext,
    @Body() dto: CreateConsentDto,
  ) {
    return this.service.registrar(ownerId, dto, {
      userId: access.userId,
      nome: access.userName,
    });
  }
}
