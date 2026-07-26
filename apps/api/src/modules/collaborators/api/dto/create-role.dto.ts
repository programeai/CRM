import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString({ message: 'Informe o nome do papel.' })
  @Length(2, 60, { message: 'O nome deve ter entre 2 e 60 caracteres.' })
  name: string;

  @IsOptional()
  @IsString({ message: 'Descrição inválida.' })
  @MaxLength(200, { message: 'A descrição deve ter no máximo 200 caracteres.' })
  description?: string;

  /**
   * Chaves do catálogo (`shared/permissions.ts`). Chave desconhecida é
   * descartada no service (`sanitizePermissionKeys`), não rejeitada — assim uma
   * permissão removida do catálogo não impede salvar o papel.
   */
  @IsArray({ message: 'Permissões inválidas.' })
  @ArrayUnique({ message: 'Permissões repetidas.' })
  @IsString({ each: true, message: 'Permissões inválidas.' })
  permissions: string[];
}
