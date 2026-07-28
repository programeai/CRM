import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  TIPOS_DE_IMPORTACAO,
  type TipoDeImportacao,
} from '../../domain/import';

/**
 * Campos de `multipart/form-data` chegam como STRING. O `ValidationPipe` global
 * tem `forbidNonWhitelisted: true`, então todo campo do form precisa estar
 * declarado aqui ou a requisição responde 400 — inclusive o que o front manda
 * "por engano".
 */
export class ImportPreviaDto {
  @IsIn(TIPOS_DE_IMPORTACAO, {
    message: 'Tipo de importação inválido: use clientes ou contatos.',
  })
  tipo: TipoDeImportacao;

  /** JSON de `{ "Coluna da planilha": "chaveDoCampo" | null }`. Ausente = o servidor sugere. */
  @IsOptional() @IsString() mapeamento?: string;
}
