/**
 * Atribuição de anúncio de um `Client`: de qual clique o lead veio.
 *
 * A lista é a FONTE ÚNICA do conjunto. Ela existe porque o mesmo conjunto de
 * campos é percorrido em três lugares (o preenchimento em
 * `ClientsService.registrarAtribuicao`, o `select`/mapper da portabilidade e a
 * seção da aba de dados no front), e uma lista literal repetida três vezes
 * envelheceria em duas delas.
 *
 * `shared/audit-diff.ts` NÃO importa daqui de propósito: `shared` não pode
 * depender de `modules`. Lá os nomes estão repetidos, com um comentário
 * apontando para cá.
 */
export const CAMPOS_DE_ATRIBUICAO = [
  'fbclid',
  'fbclidAt',
  'fbp',
  'gclid',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'landingUrl',
] as const;

export type CampoDeAtribuicao = (typeof CAMPOS_DE_ATRIBUICAO)[number];

/**
 * O valor de cada campo. `fbclidAt` é `Date` (o `fbc` precisa do instante em
 * milissegundos); o resto é texto cru da plataforma de anúncio.
 */
export type AtribuicaoDeAnuncio = {
  [K in CampoDeAtribuicao]: K extends 'fbclidAt' ? Date | null : string | null;
};
