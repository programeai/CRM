import type { CatalogKind } from './api/types';

/**
 * Rótulo do item no singular — entra em placeholder, aviso e estado vazio.
 *
 * Nenhum dos quatro catálogos tem tela própria: todos nascem, são escolhidos e
 * morrem dentro do `CatalogSelect`, no formulário onde fazem falta.
 * `tipos-de-atividade` foi o último a perder a sua, quando 'Follow-up' passou a
 * ser tipo primitivo — sem marca para mover, não sobrou regra a configurar.
 */
export const CATALOG_SINGULAR: Record<CatalogKind, string> = {
  servicos: 'tipo de serviço',
  'fontes-de-lead': 'fonte de lead',
  'tipos-de-atividade': 'tipo de atividade',
  'motivos-de-perda': 'motivo de perda',
};
