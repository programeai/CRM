import type { CatalogKind } from './api/types';

/**
 * Rótulo do item no singular — entra em placeholder, aviso e estado vazio.
 *
 * Três dos quatro catálogos não têm tela própria: `servicos`, `fontes-de-lead` e
 * `motivos-de-perda` nascem, são escolhidos e morrem dentro do `CatalogSelect`,
 * no formulário onde fazem falta. Só `tipos-de-atividade` sobrou em
 * Administração, porque carrega a marca de follow-up — que é regra, não rótulo.
 */
export const CATALOG_SINGULAR: Record<CatalogKind, string> = {
  servicos: 'tipo de serviço',
  'fontes-de-lead': 'fonte de lead',
  'tipos-de-atividade': 'tipo de atividade',
  'motivos-de-perda': 'motivo de perda',
};
