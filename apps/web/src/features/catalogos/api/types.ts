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
  /** Só em `tipos-de-atividade`. */
  isFollowUp?: boolean;
}

export interface CreateCatalogItemBody {
  name: string;
  isFollowUp?: boolean;
}

/** Única edição que existe: mover a marca de follow-up. Renomear não existe. */
export interface UpdateCatalogItemBody {
  isFollowUp?: boolean;
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
