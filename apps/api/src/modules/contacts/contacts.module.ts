import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ContactsController } from './api/contacts.controller';
import { ContactsService } from './application/contacts.service';
import { CONTACT_REPOSITORY } from './domain/contact.repository';
import { PrismaContactRepository } from './infra/prisma-contact.repository';

@Module({
  imports: [ClientsModule],
  controllers: [ContactsController],
  providers: [
    ContactsService,
    { provide: CONTACT_REPOSITORY, useClass: PrismaContactRepository },
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
