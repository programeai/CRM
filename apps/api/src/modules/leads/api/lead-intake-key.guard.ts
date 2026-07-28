import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import { ESCOPO_RECEBER_LEAD } from '../../integracoes/domain/integration-scope';
import { TokenLegadoService } from '../application/token-legado.service';
import { INTAKE_CONTEXT, type RequisicaoDeIngestao } from './intake-context';

/**
 * Autenticação da ingestão externa de lead. A rota é `@Public()` (quem chama é
 * um servidor, não uma sessão), então este guard é a única porta — e ele
 * publica no request o `ownerId` que a chave revelou, porque é ele, e nunca o
 * corpo, que decide em qual workspace a rota grava.
 *
 * DUAS credenciais são aceitas, por uma janela de transição:
 *  1. **Chave de integração** (`IntegrationKey` com escopo `lead:receber`) — o
 *     caminho novo, que traz canal, responsável e fonte de lead.
 *  2. **`LEAD_INTAKE_TOKEN` do ambiente** — o caminho LEGADO, que se comporta
 *     exatamente como antes desta fase: sem canal, sem roteamento, sem fonte.
 *     Ele existe porque o emissor (`site-v2`) vive em outro repositório: cortar
 *     sem coordenar os dois deploys perderia lead sem erro visível no site.
 *     Sai num PR próprio, junto das duas variáveis de ambiente.
 */
@Injectable()
export class LeadIntakeKeyGuard implements CanActivate {
  private readonly logger = new Logger(LeadIntakeKeyGuard.name);

  constructor(
    private readonly keys: IntegrationKeysService,
    private readonly legado: TokenLegadoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequisicaoDeIngestao>();
    const [tipo, valor] = req.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !valor) {
      // Nunca logar o valor recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'lead.token_recusado',
        msg: 'Ingestão de lead recusada por credencial ausente.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }

    // O caminho legado primeiro, e só quando ele CASA: comparação em tempo
    // constante contra o segredo do ambiente, como antes desta fase. Não casou,
    // a credencial é tratada como chave de integração.
    if (this.legado.confere(valor)) {
      const ownerId = await this.legado.resolverOwner();
      this.logger.warn({
        evento: 'lead.token_legado_aceito',
        msg: 'Ingestão aceita pelo token de ambiente (legado): sem canal, responsável nem fonte.',
        ownerId,
      });
      req[INTAKE_CONTEXT] = { ownerId, keyId: null };
      return true;
    }

    // `autenticar` lança 401 (inexistente/revogada) ou 403 (sem o escopo).
    const { ownerId, keyId } = await this.keys.autenticar(
      valor,
      ESCOPO_RECEBER_LEAD,
    );
    req[INTAKE_CONTEXT] = { ownerId, keyId };
    return true;
  }
}
