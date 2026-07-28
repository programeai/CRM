/** Os quatro catálogos configuráveis. O valor é o segmento de rota da API. */
export const CATALOG_KINDS = [
  'servicos',
  'fontes-de-lead',
  'tipos-de-atividade',
  'motivos-de-perda',
] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/**
 * Um item de catálogo. É este shape que as respostas de negócio embutem no
 * campo de relação (`deal.serviceType`, `client.source`, `activity.type`), e é
 * dele que a UI tira o rótulo — não há mais tradutor de compile-time.
 */
export interface CatalogItem {
  id: string;
  name: string;
  /**
   * Nunca é `false` numa resposta de `GET /catalogos/:kind` — item excluído
   * some da listagem. Só chega `false` embutido num registro de negócio que
   * ainda o carrega. A interface não mostra este campo: ver `ENDPOINTS.md`.
   */
  active: boolean;
  /**
   * Só em `tipos-de-atividade`, e **somente leitura**: marca o tipo primitivo
   * 'Follow-up', semeado com a conta, que é o único que os lembretes e o bloco
   * "Próximas ações" do painel usam. Não há rota que mova a marca, e o `DELETE`
   * dele responde 422 — o `CatalogSelect` esconde a lixeira nesse item.
   */
  isFollowUp?: boolean;
}

/** O nome é o único dado de um item. Não existe corpo de edição — nem `PATCH`. */
export interface CreateCatalogItemBody {
  name: string;
}

/**
 * `ocultado: true` → o item ainda rotulava `usos` registros, então a linha
 * sobreviveu invisível em vez de ser apagada. Para quem usa, os dois casos são
 * "excluí"; a distinção só muda o texto do aviso.
 */
export interface DeleteCatalogItemResult {
  ocultado: boolean;
  usos: number;
}
