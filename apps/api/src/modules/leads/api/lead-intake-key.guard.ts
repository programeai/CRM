import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import { ESCOPO_RECEBER_LEAD } from '../../integracoes/domain/integration-scope';
import { INTAKE_CONTEXT, type RequisicaoDeIngestao } from './intake-context';

/**
 * Autenticação da ingestão externa de lead. A rota é `@Public()` (quem chama é
 * um servidor, não uma sessão), então este guard é a única porta — e ele
 * publica no request o `ownerId` que a chave revelou, porque é ele, e nunca o
 * corpo, que decide em qual workspace a rota grava.
 *
 * **Uma credencial só:** chave de integração (`IntegrationKey` com escopo
 * `lead:receber`), que traz canal, responsável e fonte de lead. O caminho legado
 * por `LEAD_INTAKE_TOKEN` do ambiente existiu entre a Fase 17-A e a 19-B, para
 * o emissor (`site-v2`, outro repositório) poder migrar sem janela de perda de
 * lead, e saiu junto das duas variáveis de ambiente.
 */
@Injectable()
export class LeadIntakeKeyGuard implements CanActivate {
  private readonly logger = new Logger(LeadIntakeKeyGuard.name);

  constructor(private readonly keys: IntegrationKeysService) {}

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

    // `autenticar` lança 401 (inexistente/revogada) ou 403 (sem o escopo).
    const { ownerId, keyId } = await this.keys.autenticar(
      valor,
      ESCOPO_RECEBER_LEAD,
    );
    req[INTAKE_CONTEXT] = { ownerId, keyId };
    return true;
  }
}
