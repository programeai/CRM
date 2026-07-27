import type { CatalogItem } from '../api/types';

/**
 * Opções de um Select de catálogo: os itens ativos MAIS o item atual do
 * registro, mesmo desativado. Sem isso, editar uma oportunidade cujo tipo de
 * serviço foi desativado apagaria o valor ao abrir o formulário.
 */
export function comItemAtual(
  itens: CatalogItem[] | undefined,
  atual?: CatalogItem | null,
): CatalogItem[] {
  const lista = itens ?? [];
  if (!atual || lista.some((i) => i.id === atual.id)) return lista;
  return [...lista, atual].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
