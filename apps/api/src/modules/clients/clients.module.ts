import { forwardRef, Module } from '@nestjs/common';
import { ClientsController } from './api/clients.controller';
import { ClientsService } from './application/clients.service';
import { CLIENT_REPOSITORY } from './domain/client.repository';
import { PrismaClientRepository } from './infra/prisma-client.repository';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { DataModule } from '../data/data.module';

// `forwardRef`: este módulo importa `DataModule` pelo `ExportService`, e
// `DataModule` importa este módulo de volta pelo `ClientsService` (a
// importação de contatos precisa casar o cliente) — dependência circular real
// entre módulos do Nest. Ver o espelho e a explicação em `data.module.ts`.
@Module({
  imports: [WorkspaceModule, CatalogosModule, forwardRef(() => DataModule)],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
