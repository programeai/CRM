import type { CatalogKind } from './catalog-kind';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

/**
 * Forma comum das quatro tabelas de catálogo. `isFollowUp` só existe em
 * `ActivityTypeCatalog` — o service garante que ele não vaze para os outros.
 */
export interface CatalogItem {
  id: string;
  ownerId: string;
  name: string;
  active: boolean;
  isFollowUp?: boolean;
}

/**
 * Catálogos são dado do owner (RLS por ownerId). O filtro explícito em toda
 * assinatura é defesa em profundidade: a policy já fecha, mas o repositório não
 * depende de o contexto da transação ter sido setado.
 */
export interface CatalogRepository {
  /**
   * Ordenado por `name`. Só os vivos por padrão — item `active: false` foi
   * excluído. `incluirInativos` existe para a importação (Fase 14-A): casar a
   * planilha com um item desativado é legítimo (o dado histórico do owner
   * continua rotulado por ele), diferente de listar para exibição na UI.
   */
  findAll(
    kind: CatalogKind,
    ownerId: string,
    incluirInativos?: boolean,
  ): Promise<CatalogItem[]>;
  findById(
    kind: CatalogKind,
    id: string,
    ownerId: string,
  ): Promise<CatalogItem | null>;
  findByName(
    kind: CatalogKind,
    ownerId: string,
    name: string,
  ): Promise<CatalogItem | null>;
  create(
    kind: CatalogKind,
    data: { ownerId: string; name: string; isFollowUp?: boolean },
  ): Promise<CatalogItem>;
  update(
    kind: CatalogKind,
    id: string,
    ownerId: string,
    data: { active?: boolean; isFollowUp?: boolean },
  ): Promise<CatalogItem>;
  delete(kind: CatalogKind, id: string, ownerId: string): Promise<void>;
  /**
   * Quantos registros do owner apontam para este item — guard de exclusão. Conta
   * INCLUSIVE arquivados: as FKs são RESTRICT e um filho na lixeira faria o
   * DELETE responder 500. `servicos` soma três tabelas.
   */
  contarUsos(kind: CatalogKind, id: string, ownerId: string): Promise<number>;
  /** Desmarca `isFollowUp` dos outros itens do owner (só `tipos-de-atividade`). */
  desmarcarOutrosFollowUp(ownerId: string, exceto: string): Promise<void>;
}
