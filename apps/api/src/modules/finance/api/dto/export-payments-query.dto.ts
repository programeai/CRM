import { IsIn } from 'class-validator';
import { ListPaymentsQueryDto } from './list-payments-query.dto';
import { EXPORT_FORMATS, type ExportFormat } from '../../../../shared/export';

/**
 * Mesmos filtros da listagem + o formato. Herda `page`/`limit`, que a
 * exportação ignora — mesmo molde de `ExportClientsQueryDto`.
 */
export class ExportPaymentsQueryDto extends ListPaymentsQueryDto {
  @IsIn(EXPORT_FORMATS, { message: 'Formato inválido: use csv ou xlsx.' })
  formato: ExportFormat;
}
