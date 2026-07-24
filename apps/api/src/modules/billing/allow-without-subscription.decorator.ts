import { SetMetadata } from '@nestjs/common';

/** Marca rotas isentas do BillingGuard (rotas de billing e webhook) — senão um
 *  owner com trial expirado não conseguiria assinar (deadlock). */
export const ALLOW_WITHOUT_SUBSCRIPTION_KEY = 'allowWithoutSubscription';
export const AllowWithoutSubscription = () =>
  SetMetadata(ALLOW_WITHOUT_SUBSCRIPTION_KEY, true);
