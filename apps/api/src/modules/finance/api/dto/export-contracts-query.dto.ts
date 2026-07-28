import { IsIn } from 'class-validator';
import { ListContractsQueryDto } from './list-contracts-query.dto';
import { EXPORT_FORMATS, type ExportFormat } from '../../../../shared/export';

/**
 * Mesmos filtros da listagem + o formato. Herda `page`/`limit`, que a
 * exportação ignora — mesmo molde de `ExportClientsQueryDto`.
 */
export class ExportContractsQueryDto extends ListContractsQueryDto {
  @IsIn(EXPORT_FORMATS, { message: 'Formato inválido: use csv ou xlsx.' })
  formato: ExportFormat;
}
