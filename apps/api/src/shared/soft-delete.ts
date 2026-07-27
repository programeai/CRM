/**
 * Soft delete: `archivedAt IS NULL` é o registro ativo.
 *
 * **Sempre componha com `AND: [fragmento]`**, nunca por spread no objeto raiz,
 * pela mesma razão do `assigneeScopeWhere` (ver `shared/record-scope.ts`): o
 * `where` de várias listagens já usa `OR` para a busca textual, e um segundo
 * `OR` no mesmo nível sobrescreveria o primeiro silenciosamente. Onde não há
 * `OR`, o spread é seguro e mais legível — o padrão do `Client` (`archivedAt:
 * null` direto no objeto) permanece válido.
 */
export const ATIVO = { archivedAt: null } as const;

/** Fragmento de leitura: `undefined` quando arquivados devem entrar. */
export function ativoWhere(includeArchived = false) {
  return includeArchived ? {} : ATIVO;
}
