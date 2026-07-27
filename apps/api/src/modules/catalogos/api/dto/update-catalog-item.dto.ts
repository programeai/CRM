import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCatalogItemDto } from './create-catalog-item.dto';

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {
  /** Desativa/reativa o item. Só o PATCH mexe nisso — o POST nasce ativo. */
  @IsOptional() @IsBoolean() active?: boolean;
}
