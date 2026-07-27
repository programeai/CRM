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
  active: boolean;
  /** Só em `tipos-de-atividade`. */
  isFollowUp?: boolean;
}

export interface CreateCatalogItemBody {
  name: string;
  isFollowUp?: boolean;
}
export interface UpdateCatalogItemBody {
  name?: string;
  active?: boolean;
  isFollowUp?: boolean;
}
