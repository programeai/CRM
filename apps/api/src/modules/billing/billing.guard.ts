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
 * Gate de assinatura. Registrado como APP_GUARD **após** o AccessGuard (precisa
 * de `req.access`). Só atua quando o billing está habilitado; caso contrário
 * (autohospedagem) libera tudo. Libera também rotas públicas e as rotas de
 * billing/webhook (`@AllowWithoutSubscription()`), senão um owner bloqueado não
 * conseguiria assinar.
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
    // Owner da workspace (resolvido pelo AccessGuard, que roda antes): o
    // colaborador herda o gate da assinatura de quem o convidou — ele não tem
    // assinatura própria.
    const ownerId = req.access?.ownerId ?? req.user?.sub;
    // Rota protegida sem usuário não deveria chegar aqui (JwtAuthGuard barra antes).
    if (!ownerId) return true;

    if (!(await this.access.hasAccess(ownerId))) {
      throw new HttpException(
        'Sua assinatura expirou. Ative um plano para continuar usando o CRM.',
        HttpStatus.PAYMENT_REQUIRED, // 402
      );
    }
    return true;
  }
}
