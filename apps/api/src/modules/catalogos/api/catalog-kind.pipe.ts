import {
  Injectable,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { isCatalogKind, type CatalogKind } from '../domain/catalog-kind';

/**
 * Valida o segmento `:kind` da rota. Kind desconhecido é **404** (a rota não
 * existe), não 400 — `/catalogos/inventado` não é um corpo mal formado.
 */
@Injectable()
export class CatalogKindPipe implements PipeTransform<string, CatalogKind> {
  transform(value: string): CatalogKind {
    if (!isCatalogKind(value))
      throw new NotFoundException('Catálogo não encontrado.');
    return value;
  }
}
