import { forwardRef, Module } from '@nestjs/common';
import { ExportService } from './application/export.service';
import { ImportService } from './application/import.service';
import { CatalogResolver } from './application/catalog-resolver';
import { SpreadsheetWriter } from './infra/spreadsheet.writer';
import { SpreadsheetReader } from './infra/spreadsheet.reader';
import { ImportController } from './api/import.controller';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { ClientsModule } from '../clients/clients.module';
import { ContactsModule } from '../contacts/contacts.module';
// AuditModule é @Global() (ver app.module.ts) — AuditService chega sem import.

/**
 * Módulo transversal de entrada e saída de dados. Não é módulo de negócio: não
 * tem tabela, e as fronteiras que ele publica são `ExportService` e
 * `ImportService`.
 *
 * A exportação é declarada **no módulo dono** de cada listagem, não aqui, e o
 * motivo é de segurança, não de organização: o recorte por responsável
 * (`AssigneeScope`) NÃO é protegido pelo RLS — o banco só conhece `ownerId`. Um
 * exportador genérico que remontasse o `where` seria exatamente onde o
 * vazamento aconteceria. Aqui mora só a serialização.
 *
 * `forwardRef`: `ClientsModule` importa `DataModule` (pelo `ExportService`) e
 * `DataModule` precisa de `ClientsModule` (pelo `ClientsService`, para casar
 * contato com cliente e ler o catálogo). É uma dependência circular real entre
 * módulos do Nest — resolvida nos dois lados (ver o espelho em
 * `clients.module.ts`). A alternativa — mover o `ExportService` para fora do
 * `DataModule` — separaria import e export sem ganho real.
 */
@Module({
  imports: [CatalogosModule, ContactsModule, forwardRef(() => ClientsModule)],
  controllers: [ImportController],
  providers: [
    SpreadsheetWriter,
    SpreadsheetReader,
    ExportService,
    ImportService,
    CatalogResolver,
  ],
  exports: [ExportService],
})
export class DataModule {}
