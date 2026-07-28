import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * O nome é o único dado de um item de catálogo. `isFollowUp` não entra aqui: a
 * marca é do tipo primitivo 'Follow-up', semeado com a conta, e não se escolhe
 * ao cadastrar (ver `CatalogosService.delete`).
 */
export class CreateCatalogItemDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(60, { message: 'O nome deve ter no máximo 60 caracteres.' })
  name: string;
}
