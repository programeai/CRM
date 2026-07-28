import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { IntegrationKeysService } from '../application/integration-keys.service';
import { INTEGRATION_SCOPES } from '../domain/integration-scope';

/**
 * Chaves de integração do owner. Não há POST de criação avulsa: chave nasce
 * junto do registro que ela credencia (hoje, o canal de captação) — chave com
 * escopo `lead:receber` e sem canal autenticaria uma ingestão sem roteamento
 * nem fonte, um estado que não serve para nada.
 */
@Controller('integracoes')
export class IntegracoesController {
  constructor(private readonly keys: IntegrationKeysService) {}

  /** Catálogo de escopos — o front consome os rótulos daqui, não os duplica. */
  @Get('escopos')
  @RequirePermission('integracao:gerenciar')
  escopos() {
    return INTEGRATION_SCOPES;
  }

  @Get('chaves')
  @RequirePermission('integracao:gerenciar')
  list(@CurrentOwnerId() ownerId: string) {
    return this.keys.list(ownerId);
  }

  /** Devolve o valor bruto da chave nova — a última vez que ele existe. */
  @Post('chaves/:id/rotacionar')
  @RequirePermission('integracao:gerenciar')
  rotacionar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.rotacionar(ownerId, id);
  }

  /** Revoga (a linha continua no banco, para a tela e a trilha explicarem). */
  @Delete('chaves/:id')
  @RequirePermission('integracao:gerenciar')
  revogar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.keys.revogar(ownerId, id);
  }
}
