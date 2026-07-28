import { Module } from '@nestjs/common';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { ClientsModule } from '../clients/clients.module';
import { ContactsModule } from '../contacts/contacts.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { LeadIntakeChannelsController } from './api/lead-intake-channels.controller';
import { LeadsIntakeController } from './api/leads-intake.controller';
import { LeadIntakeKeyGuard } from './api/lead-intake-key.guard';
import { LeadIntakeChannelsService } from './application/lead-intake-channels.service';
import { LeadsIntakeService } from './application/leads-intake.service';
import { TokenLegadoService } from './application/token-legado.service';
import { LEAD_INTAKE_CHANNEL_REPOSITORY } from './domain/lead-intake-channel.repository';
import { PrismaLeadIntakeChannelRepository } from './infra/prisma-lead-intake-channel.repository';

/**
 * Ingestão de lead capturado fora do CRM, e a configuração de quem recebe.
 *
 * **Passou a ser dono de tabela** nesta fase (`LeadIntakeChannel`), por isso
 * ganhou `domain/` e `infra/`. A credencial que autentica a entrega é genérica e
 * mora em `integracoes` — a dependência aponta leads → integracoes, nunca o
 * contrário, e é isso que permite à Fase 19-B acrescentar escopo novo sem passar
 * por captação.
 *
 * `NotificationsModule` é `@Global()`, por isso não aparece nos imports.
 */
@Module({
  imports: [
    ClientsModule,
    ContactsModule,
    IntegracoesModule,
    CatalogosModule,
    WorkspaceModule,
  ],
  controllers: [LeadsIntakeController, LeadIntakeChannelsController],
  providers: [
    LeadsIntakeService,
    LeadIntakeChannelsService,
    TokenLegadoService,
    LeadIntakeKeyGuard,
    {
      provide: LEAD_INTAKE_CHANNEL_REPOSITORY,
      useClass: PrismaLeadIntakeChannelRepository,
    },
  ],
})
export class LeadsModule {}
