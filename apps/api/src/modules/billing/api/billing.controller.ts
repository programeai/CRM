import { Controller, Get, Post } from '@nestjs/common';
import { BillingService } from '../application/billing.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { AllowWithoutSubscription } from '../allow-without-subscription.decorator';

// Isentas do gate: um owner com trial expirado precisa acessar estas rotas
// para assinar/gerenciar/consultar o status.
@AllowWithoutSubscription()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Inicia o Checkout do Stripe para o owner da workspace. */
  @RequirePermission('assinatura:gerenciar')
  @Post('checkout')
  checkout(@CurrentOwnerId() ownerId: string) {
    return this.billing.createCheckoutSession(ownerId);
  }

  /** Abre o Customer Portal do Stripe para o owner da workspace. */
  @RequirePermission('assinatura:gerenciar')
  @Post('portal')
  portal(@CurrentOwnerId() ownerId: string) {
    return this.billing.createPortalSession(ownerId);
  }

  /**
   * Status da assinatura da workspace. **Sem** exigir permissão de propósito:
   * qualquer colaborador precisa dele para a interface saber se o billing está
   * ativo e para a tela de bloqueio explicar o que aconteceu. Só alterar o plano
   * é restrito (`assinatura:gerenciar`).
   */
  @Get('status')
  status(@CurrentOwnerId() ownerId: string) {
    return this.billing.getStatus(ownerId);
  }
}
