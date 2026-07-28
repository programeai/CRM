import { UnprocessableEntityException } from '@nestjs/common';

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Teto de linhas de uma exportação. Existe porque a resposta é montada em
 * memória **dentro da transação do request** (5s de orçamento): streaming
 * manteria a transação aberta durante todo o download, segurando conexão do
 * pool. Acima do teto a resposta é 422 com instrução — nunca truncagem
 * silenciosa, que se leria como "exportei tudo".
 */
export const MAX_EXPORT_ROWS = 5000;

/**
 * Uma coluna da planilha exportada. O `value` devolve o valor **já legível**:
 * o rótulo pt-BR do enum, o `name` do item de catálogo, o número como número.
 * Nada de identificador técnico na planilha do usuário (regra do CLAUDE.md).
 *
 * O tipo do retorno importa: só `string` recebe a escapatória de fórmula do
 * CSV — prefixar um número negativo com `'` o transformaria em texto.
 */
export interface ExportColumn<T> {
  /** Cabeçalho em pt-BR. É o que o usuário vê na primeira linha. */
  header: string;
  value: (row: T) => string | number | Date | null;
  /** Largura da coluna no XLSX, em caracteres. Ignorada no CSV. */
  width?: number;
}

export function assertCabeNaExportacao(total: number): void {
  if (total > MAX_EXPORT_ROWS) {
    throw new UnprocessableEntityException(
      `A exportação está limitada a ${MAX_EXPORT_ROWS.toLocaleString('pt-BR')} linhas e o filtro atual seleciona ${total.toLocaleString('pt-BR')}. Refine os filtros e tente de novo.`,
    );
  }
}
