import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Autenticação da ingestão externa de lead. A rota é `@Public()` (não existe
 * sessão do outro lado: quem chama é o servidor do site), então este guard é a
 * única porta — e por isso ele não tem "modo permissivo": sem
 * `LEAD_INTAKE_TOKEN` no ambiente a rota responde 503 e não aceita nada.
 *
 * O token é um segredo compartilhado, não um JWT: a integração é servidor a
 * servidor e o dono das duas pontas é o mesmo. O que ele autentica é "esta
 * requisição vem da minha captação", e é a ROTA que decide em qual conta grava
 * (`LEAD_INTAKE_OWNER_EMAIL`) — o corpo nunca escolhe owner.
 *
 * Comparação sobre o SHA-256 dos dois lados, não sobre o texto: `timingSafeEqual`
 * exige buffers do mesmo tamanho (com tamanhos diferentes ele lança, e o próprio
 * lançar vaza o tamanho do segredo), e o digest normaliza isso em 32 bytes.
 */
@Injectable()
export class LeadIntakeTokenGuard implements CanActivate {
  private readonly logger = new Logger(LeadIntakeTokenGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperado = this.config.get<string>('LEAD_INTAKE_TOKEN') ?? '';
    if (!esperado) {
      this.logger.warn({
        evento: 'lead.ingestao_desconfigurada',
        msg: 'Ingestão de lead recebida sem LEAD_INTAKE_TOKEN no ambiente.',
      });
      throw new ServiceUnavailableException(
        'A ingestão de leads não está configurada nesta instância.',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const [tipo, token] = req.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token || !this.confere(token, esperado)) {
      // Nunca logar o token recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'lead.token_recusado',
        msg: 'Ingestão de lead recusada por token inválido.',
      });
      throw new UnauthorizedException('Token de ingestão inválido.');
    }
    return true;
  }

  private confere(recebido: string, esperado: string): boolean {
    const digest = (valor: string) =>
      createHash('sha256').update(valor, 'utf8').digest();
    return timingSafeEqual(digest(recebido), digest(esperado));
  }
}
