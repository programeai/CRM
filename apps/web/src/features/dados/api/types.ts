/** Espelha `apps/api/src/modules/data/domain/import.ts`. */

export const TIPOS_DE_IMPORTACAO = ['clientes', 'contatos'] as const;
export type TipoDeImportacao = (typeof TIPOS_DE_IMPORTACAO)[number];

export interface CampoImportavel {
  chave: string;
  rotulo: string;
  obrigatorio?: boolean;
  apelidos?: string[];
  catalogo?: 'fontes-de-lead';
}

/** Erro de uma linha. `linha` é o número na planilha (cabeçalho = 1). */
export interface LinhaComErro {
  linha: number;
  campo?: string;
  mensagem: string;
}

export interface PreviaDeImportacao {
  tipo: TipoDeImportacao;
  totalDeLinhas: number;
  colunas: string[];
  campos: CampoImportavel[];
  /** coluna da planilha → chave do campo (ou `null` para "não importar"). */
  mapeamento: Record<string, string | null>;
  amostra: Record<string, string>[];
  origensDesconhecidas: string[];
  erros: LinhaComErro[];
  validas: number;
}

/** Decisão do usuário sobre uma origem que não existe no catálogo dele. */
export interface DecisaoDeOrigem {
  valor: string;
  acao: 'criar' | 'usar' | 'ignorar';
  itemId?: string;
}

export interface RelatorioDeImportacao {
  tipo: TipoDeImportacao;
  totalDeLinhas: number;
  criados: number;
  origensCriadas: string[];
  origensIgnoradas: string[];
  erros: LinhaComErro[];
}
