import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { StripeService } from './application/stripe.service';
import { SubscriptionAccessService } from './application/subscription-access.service';
import { ALLOW_WITHOUT_SUBSCRIPTION_KEY } from './allow-without-subscription.decorator';
import type { AuthenticatedRequest } from '../access/domain/access-context';

/**
 * Métodos que só leem. O gate nunca os barra: quem deixou de pagar continua
 * consultando tudo que já cadastrou — o que ele perde é o avanço no uso.
 */
const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Gate de assinatura. Registrado como APP_GUARD **após** o AccessGuard (precisa
 * de `req.access`). Só atua quando o billing está habilitado; caso contrário
 * (autohospedagem) libera tudo. Libera também rotas públicas e as rotas de
 * billing/webhook (`@AllowWithoutSubscription()`), senão um owner bloqueado não
 * conseguiria assinar.
 *
 * **O bloqueio é só de escrita.** Sem assinatura ativa o owner mantém acesso de
 * leitura ao histórico inteiro (é o que os Termos prometem: "seus dados
 * continuam guardados") e segue podendo cadastrar cliente novo — nenhum lead se
 * perde durante a inadimplência. Todo o resto que escreve responde `402`.
 */
@Injectable()
export class BillingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stripe: StripeService,
    private readonly access: SubscriptionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Billing off (autohospedagem) → sem gate.
    if (!this.stripe.enabled) return true;

    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) return true;

    const allowWithout = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WITHOUT_SUBSCRIPTION_KEY,
      targets,
    );
    if (allowWithout) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Leitura passa sempre — inclusive as exportações, que são `GET`. Vale
    // também para `GET /auth/me`: sem isso o front não carregaria as permissões
    // e nem o próprio dono veria o botão de assinar.
    if (METODOS_DE_LEITURA.has(req.method)) return true;

    // Owner da workspace (resolvido pelo AccessGuard, que roda antes): o
    // colaborador herda o gate da assinatura de quem o convidou — ele não tem
    // assinatura própria.
    const ownerId = req.access?.ownerId ?? req.user?.sub;
    // Rota protegida sem usuário não deveria chegar aqui (JwtAuthGuard barra antes).
    if (!ownerId) return true;

    if (!(await this.access.hasAccess(ownerId))) {
      throw new HttpException(
        'Sua assinatura está inativa. Você continua consultando o que já cadastrou e registrando novos clientes, mas as demais ações exigem uma assinatura ativa.',
        HttpStatus.PAYMENT_REQUIRED, // 402
      );
    }
    return true;
  }
}
