import { Module } from '@nestjs/common';
import { IntegracoesController } from './api/integracoes.controller';
import { IntegrationKeysService } from './application/integration-keys.service';
import { INTEGRATION_KEY_REPOSITORY } from './domain/integration-key.repository';
import { PrismaIntegrationKeyRepository } from './infra/prisma-integration-key.repository';

/**
 * Credencial de máquina por owner. Não importa módulo de negócio nenhum e não
 * conhece lead: é o que permite a Fase 19-B acrescentar escopo de webhook
 * reusando esta máquina sem passar por captação. Quem depende é `leads`.
 */
@Module({
  controllers: [IntegracoesController],
  providers: [
    IntegrationKeysService,
    {
      provide: INTEGRATION_KEY_REPOSITORY,
      useClass: PrismaIntegrationKeyRepository,
    },
  ],
  exports: [IntegrationKeysService],
})
export class IntegracoesModule {}
