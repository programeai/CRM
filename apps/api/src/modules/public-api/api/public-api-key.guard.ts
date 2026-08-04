import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import type { IntegrationScope } from '../../integracoes/domain/integration-scope';
import { API_CONTEXT, type RequisicaoDaApi } from './api-context';
import { ESCOPO_EXIGIDO } from './escopo-exigido.decorator';

/**
 * Autenticação da API pública. As rotas são `@Public()` (quem chama é um
 * servidor, não uma sessão), então este guard é a única porta — e ele publica no
 * request o `ownerId` que a chave revelou, porque é ele, e nunca o corpo, que
 * decide em qual workspace a rota grava.
 *
 * Diferente do `LeadIntakeKeyGuard`: **não há caminho legado** e o escopo não é
 * fixo — vem do `@EscopoExigido()` da rota. Sem o decorator o guard FECHA a
 * rota, em vez de aceitar qualquer chave: escopo esquecido é bug de rota nova, e
 * o estado seguro é recusar.
 */
@Injectable()
export class PublicApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(PublicApiKeyGuard.name);

  constructor(
    private readonly keys: IntegrationKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const escopo = this.reflector.getAllAndOverride<IntegrationScope>(
      ESCOPO_EXIGIDO,
      [context.getHandler(), context.getClass()],
    );
    if (!escopo) {
      this.logger.error({
        evento: 'api_publica.rota_sem_escopo',
        msg: 'Rota da API pública sem @EscopoExigido: recusada por segurança.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }

    const req = context.switchToHttp().getRequest<RequisicaoDaApi>();
    const [tipo, valor] = req.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !valor) {
      // Nunca logar o valor recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'api_publica.credencial_ausente',
        msg: 'Requisição à API pública sem credencial Bearer.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }

    // `autenticar` lança 401 (inexistente/revogada) ou 403 (sem o escopo), e
    // loga `integracao.chave_recusada` / `integracao.escopo_insuficiente`.
    req[API_CONTEXT] = await this.keys.autenticar(valor, escopo);
    return true;
  }
}
