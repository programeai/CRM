/**
 * Catálogos padrão de uma conta nova. **Não** são catálogo global: são o ponto
 * de partida copiado para cada owner na criação da conta (ver `UsersService`),
 * que depois renomeia, desativa, acrescenta e exclui livremente.
 *
 * Os nomes SÃO os rótulos pt-BR que viviam em `apps/web/src/lib/labels.ts` até a
 * Fase 13-A — o mesmo conteúdo, saindo de compile-time para dado.
 *
 * Fonte única — consumida pelo provisionamento da conta e pelo `prisma/seed.ts`.
 * As migrations 20260805100000…20260808100000 replicaram estas mesmas listas
 * para os owners anteriores ao deploy; mudar um nome aqui NÃO reescreve o
 * passado.
 */
export const DEFAULT_SERVICE_CATALOG = [
  'Software',
  'Website',
  'Tráfego pago',
] as const;

export const DEFAULT_LEAD_SOURCE_CATALOG = [
  'Indicação',
  'Tráfego pago',
  'Orgânico',
  'Prospecção ativa',
  'Outro',
] as const;

/**
 * `isFollowUp` é REGRA, não rótulo: o cron de lembretes e o dashboard filtram por
 * ela. Exatamente um item nasce marcado.
 */
export const DEFAULT_ACTIVITY_TYPE_CATALOG = [
  { name: 'Anotação', isFollowUp: false },
  { name: 'Ligação', isFollowUp: false },
  { name: 'Reunião', isFollowUp: false },
  { name: 'E-mail', isFollowUp: false },
  { name: 'WhatsApp', isFollowUp: false },
  { name: 'Follow-up', isFollowUp: true },
] as const;

export const DEFAULT_LOST_REASON_CATALOG = [
  'Preço',
  'Prazo',
  'Sem resposta',
  'Escolheu concorrente',
  'Sem verba',
  'Fora do perfil',
  'Outro',
] as const;

/** Listas prontas para `create` aninhado (o `ownerId` vem do nested create). */
export function defaultLeadSourceCatalog(): { name: string }[] {
  return DEFAULT_LEAD_SOURCE_CATALOG.map((name) => ({ name }));
}
export function defaultServiceCatalog(): { name: string }[] {
  return DEFAULT_SERVICE_CATALOG.map((name) => ({ name }));
}
export function defaultActivityTypeCatalog(): {
  name: string;
  isFollowUp: boolean;
}[] {
  return DEFAULT_ACTIVITY_TYPE_CATALOG.map((item) => ({ ...item }));
}
export function defaultLostReasonCatalog(): { name: string }[] {
  return DEFAULT_LOST_REASON_CATALOG.map((name) => ({ name }));
}

/**
 * Quantos itens uma conta nova recebe somando os catálogos JÁ provisionados —
 * é o `quantidade` do log `catalogo.itens_provisionados`. Cresce a cada fase da
 * 13-A que passa a semear mais uma lista em `UsersService`; manter em sincronia
 * com os nested creates de lá.
 */
export function totalDeItensDeCatalogo(): number {
  return (
    DEFAULT_LEAD_SOURCE_CATALOG.length +
    DEFAULT_LOST_REASON_CATALOG.length +
    DEFAULT_SERVICE_CATALOG.length +
    DEFAULT_ACTIVITY_TYPE_CATALOG.length
  );
}
