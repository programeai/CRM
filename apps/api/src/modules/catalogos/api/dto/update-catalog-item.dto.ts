import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Só a marca de follow-up. Renomear não é operação do produto — troca-se o item
 * por outro —, e `active` não é decisão de quem usa: é o efeito colateral do
 * DELETE num item que ainda rotula registros (ver `CatalogosService.delete`).
 */
export class UpdateCatalogItemDto {
  @IsOptional() @IsBoolean() isFollowUp?: boolean;
}
