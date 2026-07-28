import { IsIn } from 'class-validator';
import { ListClientsQueryDto } from './list-clients-query.dto';
import { EXPORT_FORMATS, type ExportFormat } from '../../../../shared/export';

/**
 * Mesmos filtros da listagem + o formato. Herda `page`/`limit` do
 * `PaginationQueryDto`, que a exportação ignora — o `ValidationPipe` global tem
 * `forbidNonWhitelisted: true`, então declarar a herança é mais barato que
 * responder 400 para quem exportou estando na página 3.
 */
export class ExportClientsQueryDto extends ListClientsQueryDto {
  @IsIn(EXPORT_FORMATS, { message: 'Formato inválido: use csv ou xlsx.' })
  formato: ExportFormat;
}
