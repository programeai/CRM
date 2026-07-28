/**
 * As quatro listas configuráveis pelo owner. O valor é o segmento de rota
 * (`/catalogos/servicos`) — em pt-BR, como o resto da fronteira HTTP do projeto.
 *
 * `kind` NÃO é dado: é código. A lista fechada aqui é intencional — o owner
 * configura os *itens* de cada catálogo, não quais catálogos existem.
 */
export const CATALOG_KINDS = [
  'servicos',
  'fontes-de-lead',
  'tipos-de-atividade',
  'motivos-de-perda',
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export function isCatalogKind(value: string): value is CatalogKind {
  return (CATALOG_KINDS as readonly string[]).includes(value);
}

/** Rótulo do item no singular — entra nas mensagens de erro em pt-BR. */
export const CATALOG_LABELS: Record<CatalogKind, string> = {
  servicos: 'tipo de serviço',
  'fontes-de-lead': 'fonte de lead',
  'tipos-de-atividade': 'tipo de atividade',
  'motivos-de-perda': 'motivo de perda',
};
