import { Global, Module } from '@nestjs/common';
import { AccessService } from './application/access.service';
import { PermissionsController } from './api/permissions.controller';

/**
 * Recurso transversal de autorização: resolve o contexto de acesso da
 * requisição (workspace + permissões) e publica o catálogo de permissões.
 *
 * `@Global()` porque o `AccessGuard` é registrado como `APP_GUARD` no
 * `AppModule` e precisa do `AccessService` sem que cada módulo de negócio
 * reimporte este aqui.
 */
@Global()
@Module({
  providers: [AccessService],
  controllers: [PermissionsController],
  exports: [AccessService],
})
export class AccessModule {}
