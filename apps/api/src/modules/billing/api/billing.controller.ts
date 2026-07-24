import { Controller, Get, Post } from '@nestjs/common';
import { BillingService } from '../application/billing.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { AllowWithoutSubscription } from '../allow-without-subscription.decorator';

// Isentas do gate: um owner com trial expirado precisa acessar estas rotas
// para assinar/gerenciar/consultar o status.
@AllowWithoutSubscription()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Inicia o Checkout do Stripe para o owner atual. */
  @Post('checkout')
  checkout(@CurrentUserId() ownerId: string) {
    return this.billing.createCheckoutSession(ownerId);
  }

  /** Abre o Customer Portal do Stripe para o owner atual. */
  @Post('portal')
  portal(@CurrentUserId() ownerId: string) {
    return this.billing.createPortalSession(ownerId);
  }

  /** Status da assinatura do owner atual. */
  @Get('status')
  status(@CurrentUserId() ownerId: string) {
    return this.billing.getStatus(ownerId);
  }
}
