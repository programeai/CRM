import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ContactsModule } from '../contacts/contacts.module';
import { UsersModule } from '../users/users.module';
import { ConsentController } from './api/consent.controller';
import { ConsentService } from './application/consent.service';
import { CONSENT_REPOSITORY } from './domain/consent.repository';
import { PrismaConsentRepository } from './infra/prisma-consent.repository';

/**
 * Livro-razão de consentimento dos titulares. Exporta o `ConsentService` porque o
 * módulo `account` o consome: os registros entram no dump de portabilidade da
 * 19-A (o titular tem direito a saber o que o CRM guarda sobre ele — inclusive a
 * prova de consentimento).
 */
@Module({
  imports: [ClientsModule, ContactsModule, UsersModule],
  controllers: [ConsentController],
  providers: [
    ConsentService,
    { provide: CONSENT_REPOSITORY, useClass: PrismaConsentRepository },
  ],
  exports: [ConsentService],
})
export class ConsentModule {}
