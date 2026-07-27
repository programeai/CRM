import { Module } from '@nestjs/common';
import { ClientsController } from './api/clients.controller';
import { ClientsService } from './application/clients.service';
import { CLIENT_REPOSITORY } from './domain/client.repository';
import { PrismaClientRepository } from './infra/prisma-client.repository';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CatalogosModule } from '../catalogos/catalogos.module';

@Module({
  imports: [WorkspaceModule, CatalogosModule],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
