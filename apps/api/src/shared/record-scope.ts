import type { AccessContext } from '../modules/access/domain/access-context';

/**
 * Recorte por responsável de uma leitura.
 *
 *  - `all`               → sem restrição (tem a chave `:ver_todos`, ou é owner).
 *  - `mine`              → estritamente os do usuário (alternador "Somente meus").
 *  - `mineOrUnassigned`  → os do usuário **mais** os sem responsável. É o escopo de
 *    quem não tem a chave ampla: registro sem responsável é visível para todos, senão
 *    o lead novo ficaria invisível (e o roteamento da Fase 15 não teria de onde partir).
 */
export type AssigneeScope =
  | { kind: 'all' }
  | { kind: 'mine'; userId: string }
  | { kind: 'mineOrUnassigned'; userId: string };

/** Sem recorte — para chamadas internas entre módulos (validação de posse). */
export const ALL_RECORDS: AssigneeScope = { kind: 'all' };

/**
 * Decide o recorte de uma leitura. O `AccessGuard` já liberou a rota; aqui a
 * consulta é estreitada — mesmo desenho de `DashboardService.summary`.
 *
 * `onlyMine` (alternador da interface) sempre vence: é o recorte mais estrito, e
 * aplicá-lo a quem já é restrito apenas remove os sem responsável.
 *
 * Owner e papel `system` recebem `:ver_todos` via `ALL_PERMISSION_KEYS`, então
 * caem em `all` sem verificação especial.
 */
export function resolveAssigneeScope(
  access: AccessContext,
  seeAllKey: string,
  onlyMine = false,
): AssigneeScope {
  if (onlyMine) return { kind: 'mine', userId: access.userId };
  return (access.permissions as readonly string[]).includes(seeAllKey)
    ? { kind: 'all' }
    : { kind: 'mineOrUnassigned', userId: access.userId };
}

/**
 * Fragmento de `where` do Prisma, ou `null` quando não há recorte.
 *
 * **Sempre componha com `AND: [fragmento]`**, nunca por spread no objeto raiz: o
 * `where` de `Client` já usa `OR` para a busca textual, e um segundo `OR` no mesmo
 * nível sobrescreveria o primeiro silenciosamente.
 */
export function assigneeScopeWhere(
  scope: AssigneeScope,
):
  | { assigneeId: string }
  | { OR: [{ assigneeId: string }, { assigneeId: null }] }
  | null {
  switch (scope.kind) {
    case 'all':
      return null;
    case 'mine':
      return { assigneeId: scope.userId };
    case 'mineOrUnassigned':
      return { OR: [{ assigneeId: scope.userId }, { assigneeId: null }] };
  }
}
