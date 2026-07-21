import { Module } from '@nestjs/common';
import { ClientsController } from './api/clients.controller';
import { ClientsService } from './application/clients.service';
import { CLIENT_REPOSITORY } from './domain/client.repository';
import { PrismaClientRepository } from './infra/prisma-client.repository';

@Module({
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
