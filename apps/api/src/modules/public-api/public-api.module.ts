import { Module } from '@nestjs/common';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { ClientsModule } from '../clients/clients.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ActivitiesModule } from '../activities/activities.module';
import { ProjectsModule } from '../projects/projects.module';
import { PublicApiController } from './api/public-api.controller';
import { PublicApiKeyGuard } from './api/public-api-key.guard';
import { PublicWriteService } from './application/public-write.service';

/**
 * A superfície de escrita para sistema de fora. Não tem tabela própria: é uma
 * FRONTEIRA — DTOs públicos, autenticação por chave e contexto de RLS na mão —
 * na frente dos services de negócio que já existem.
 *
 * Os DTOs são próprios de propósito, e não `CreateClientDto` reusado: o DTO
 * interno é contrato de UI e muda com a tela; este é contrato público, e mudá-lo
 * quebra integrador. Reusar faria de toda mudança interna uma breaking change
 * externa, e é essa separação que torna o OpenAPI da fase 3 seguro de publicar.
 */
@Module({
  imports: [
    IntegracoesModule,
    ClientsModule,
    PipelineModule,
    ActivitiesModule,
    ProjectsModule,
  ],
  controllers: [PublicApiController],
  providers: [PublicWriteService, PublicApiKeyGuard],
})
export class PublicApiModule {}
