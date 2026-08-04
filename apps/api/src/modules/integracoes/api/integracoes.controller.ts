import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { IntegrationKeysService } from '../application/integration-keys.service';
import { INTEGRATION_SCOPES } from '../domain/integration-scope';
import { idDeRota } from '../../../shared/validation/validacao-em-pt-br';
import { CreateIntegrationKeyDto } from './dto/create-integration-key.dto';

/**
 * Chaves de integração do owner.
 *
 * Duas portas de criação, e a distinção é de PROPÓSITO, não de mecânica:
 *  - **Canal de captação** (`POST /leads/canais`) emite chave com escopo
 *    `lead:receber`, porque lead sem canal não tem roteamento nem fonte;
 *  - **Chave de API** (`POST /integracoes/chaves`, aqui) emite chave para um
 *    sistema externo escrever no pipeline. Não tem registro-mãe, e não precisa:
 *    a restrição da 17-A era do escopo de lead, não da máquina de segredo.
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

  /** Emite chave avulsa. Devolve o valor bruto — a única vez que ele existe. */
  @Post('chaves')
  @RequirePermission('integracao:gerenciar')
  criar(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: CreateIntegrationKeyDto,
  ) {
    return this.keys.emitir({
      ownerId,
      name: dto.nome,
      scopes: dto.escopos,
    });
  }

  /** Devolve o valor bruto da chave nova — a última vez que ele existe. */
  @Post('chaves/:id/rotacionar')
  @RequirePermission('integracao:gerenciar')
  rotacionar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
  ) {
    return this.keys.rotacionar(ownerId, id);
  }

  /** Revoga (a linha continua no banco, para a tela e a trilha explicarem). */
  @Delete('chaves/:id')
  @RequirePermission('integracao:gerenciar')
  revogar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
  ) {
    return this.keys.revogar(ownerId, id);
  }
}
