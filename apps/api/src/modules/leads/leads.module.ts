import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ContactsModule } from '../contacts/contacts.module';
import { LeadsIntakeController } from './api/leads-intake.controller';
import { LeadIntakeTokenGuard } from './api/lead-intake-token.guard';
import { LeadsIntakeService } from './application/leads-intake.service';

/**
 * Ingestão de lead capturado fora do CRM.
 *
 * Não tem `domain/` nem `infra/`: o módulo não é dono de tabela nenhuma. Ele
 * compõe os services públicos de `clients` e `contacts` (a fronteira que aqueles
 * módulos exportam), e a única regra que é dele é a de ingestão — deduplicar por
 * telefone, montar a nota e avisar o owner.
 *
 * `NotificationsModule` é `@Global()`, por isso não aparece nos imports.
 */
@Module({
  imports: [ClientsModule, ContactsModule],
  controllers: [LeadsIntakeController],
  providers: [LeadsIntakeService, LeadIntakeTokenGuard],
})
export class LeadsModule {}
