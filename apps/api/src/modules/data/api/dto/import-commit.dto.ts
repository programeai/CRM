import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  TIPOS_DE_IMPORTACAO,
  type TipoDeImportacao,
} from '../../domain/import';

/**
 * Como o `ImportPreviaDto`, mas `mapeamento` é **obrigatório** — o commit não
 * sugere mapeamento, ele grava com o que o usuário confirmou na prévia — e
 * entra `origens`, a decisão sobre cada origem desconhecida.
 */
export class ImportCommitDto {
  @IsIn(TIPOS_DE_IMPORTACAO, {
    message: 'Tipo de importação inválido: use clientes ou contatos.',
  })
  tipo: TipoDeImportacao;

  /** JSON de `{ "Coluna da planilha": "chaveDoCampo" | null }`. */
  @IsString({ message: 'Mapeie as colunas da planilha antes de importar.' })
  mapeamento: string;

  /** JSON de `DecisaoDeOrigem[]`. Ausente = nenhuma origem desconhecida a decidir. */
  @IsOptional()
  @IsString({ message: 'Decisões de origem inválidas.' })
  origens?: string;
}
