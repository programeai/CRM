export const TIPOS_DE_IMPORTACAO = ['clientes', 'contatos'] as const;
export type TipoDeImportacao = (typeof TIPOS_DE_IMPORTACAO)[number];

export interface CampoImportavel {
  /** Chave técnica — nunca aparece na interface. */
  chave: string;
  /** Rótulo pt-BR exibido no seletor de mapeamento. */
  rotulo: string;
  obrigatorio?: boolean;
  /**
   * Nomes de coluna que casam com este campo na sugestão automática, já
   * normalizados (minúscula, sem acento). O `rotulo` entra sozinho.
   */
  apelidos?: string[];
  /** Campo que resolve contra um catálogo do owner, não contra texto livre. */
  catalogo?: 'fontes-de-lead';
}

/**
 * `personType` NÃO está aqui de propósito: é deduzido do documento desde
 * `b212eb6`. Coluna "Tipo de pessoa" na planilha é ignorada — deixá-la disputar
 * com a dedução daria duas fontes de verdade para o mesmo campo.
 */
export const CAMPOS_DE_CLIENTE: CampoImportavel[] = [
  {
    chave: 'name',
    rotulo: 'Nome',
    obrigatorio: true,
    apelidos: ['razao social', 'cliente', 'empresa'],
  },
  { chave: 'tradeName', rotulo: 'Nome fantasia', apelidos: ['fantasia'] },
  {
    chave: 'document',
    rotulo: 'CPF/CNPJ',
    apelidos: ['documento', 'cpf', 'cnpj', 'cpf cnpj'],
  },
  { chave: 'email', rotulo: 'E-mail', apelidos: ['email'] },
  {
    chave: 'phone',
    rotulo: 'Telefone',
    apelidos: ['fone', 'celular', 'whatsapp'],
  },
  { chave: 'website', rotulo: 'Site', apelidos: ['website', 'url'] },
  {
    chave: 'sourceId',
    rotulo: 'Origem',
    apelidos: ['fonte', 'fonte de lead'],
    catalogo: 'fontes-de-lead',
  },
  { chave: 'status', rotulo: 'Status', apelidos: ['situacao'] },
  { chave: 'tags', rotulo: 'Tags', apelidos: ['etiquetas'] },
  {
    chave: 'notes',
    rotulo: 'Observações',
    apelidos: ['observacao', 'obs', 'notas'],
  },
  { chave: 'zipCode', rotulo: 'CEP' },
  { chave: 'street', rotulo: 'Logradouro', apelidos: ['endereco', 'rua'] },
  { chave: 'number', rotulo: 'Número', apelidos: ['numero'] },
  { chave: 'complement', rotulo: 'Complemento' },
  { chave: 'district', rotulo: 'Bairro' },
  { chave: 'city', rotulo: 'Cidade' },
  { chave: 'state', rotulo: 'UF', apelidos: ['estado'] },
];

/**
 * Contato é filho de cliente e a planilha não cria o pai: pelo menos uma das
 * duas colunas de identificação do cliente tem de estar mapeada.
 */
export const CAMPOS_DE_CONTATO: CampoImportavel[] = [
  {
    chave: 'clienteDocumento',
    rotulo: 'CPF/CNPJ do cliente',
    apelidos: ['documento do cliente', 'cnpj do cliente', 'cpf do cliente'],
  },
  {
    chave: 'clienteNome',
    rotulo: 'Nome do cliente',
    apelidos: ['cliente', 'empresa'],
  },
  {
    chave: 'name',
    rotulo: 'Nome do contato',
    obrigatorio: true,
    apelidos: ['contato', 'nome'],
  },
  { chave: 'role', rotulo: 'Cargo', apelidos: ['funcao'] },
  { chave: 'email', rotulo: 'E-mail', apelidos: ['email'] },
  {
    chave: 'phone',
    rotulo: 'Telefone',
    apelidos: ['fone', 'celular', 'whatsapp'],
  },
  { chave: 'isPrimary', rotulo: 'Principal', apelidos: ['contato principal'] },
];

export function camposDe(tipo: TipoDeImportacao): CampoImportavel[] {
  return tipo === 'clientes' ? CAMPOS_DE_CLIENTE : CAMPOS_DE_CONTATO;
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
  /** Dez primeiras linhas já mapeadas, para conferência visual. */
  amostra: Record<string, string>[];
  /** Valores de Origem que não casam com nenhum item do catálogo do owner. */
  origensDesconhecidas: string[];
  erros: LinhaComErro[];
  /** Quantas linhas passariam sem erro com o mapeamento atual. */
  validas: number;
}

/** Decisão do usuário sobre uma origem que não existe no catálogo dele. */
export interface DecisaoDeOrigem {
  /** O valor exatamente como veio da planilha. */
  valor: string;
  acao: 'criar' | 'usar' | 'ignorar';
  /** Item existente escolhido — obrigatório em `usar`. */
  itemId?: string;
}

export interface RelatorioDeImportacao {
  tipo: TipoDeImportacao;
  totalDeLinhas: number;
  criados: number;
  origensCriadas: string[];
  origensIgnoradas: string[];
  /** Sempre vazio num 200 — erro cancela a importação inteira (ver o 422). */
  erros: LinhaComErro[];
}
