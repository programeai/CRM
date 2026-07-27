import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useMe } from '@/features/perfil/api/hooks';

export interface WorkspaceMember {
  id: string;
  name: string;
  isOwner: boolean;
}

export const membersLookupApi = {
  list: () => api.get<WorkspaceMember[]>('/workspace/members').then((r) => r.data),
};

/** Membros da workspace para os seletores de responsável. Lista curta e estável. */
export function useWorkspaceMembers() {
  return useQuery({
    queryKey: queryKeys.workspaceMembers,
    queryFn: membersLookupApi.list,
    staleTime: 5 * 60 * 1000,
  });
}

/** Sentinela do item "Sem responsável" — o `Select` do base-ui não aceita valor vazio. */
export const NO_ASSIGNEE = 'none';

/** Valor do filtro de responsável dos quadros: "todos" (o default) e "atribuídos a mim". */
export const ASSIGNEE_FILTER_ALL = 'all';
export const ASSIGNEE_FILTER_ME = 'me';

/**
 * Traduz o valor do filtro (persistido na URL) no `assigneeId` enviado à API:
 * `''` → sem filtro; `'me'` → o id do usuário logado; qualquer outro → o próprio id.
 *
 * A filtragem é **do servidor** (ao contrário dos demais filtros dos quadros, que
 * são client-side): o recorte precisa valer também para quem não tem a chave ampla.
 */
export function useResolvedAssigneeFilter(value: string): string | undefined {
  const { data: me } = useMe();
  if (!value) return undefined;
  return value === ASSIGNEE_FILTER_ME ? me?.id : value;
}

/**
 * Mapa value→rótulo que o `Select` usa para exibir o nome no gatilho (senão mostra
 * o id cru). Inclui o responsável atual mesmo que ele não esteja mais na lista de
 * membros (desativado depois de atribuído — decisão: não zerar o histórico).
 */
export function buildMemberItems(
  members: WorkspaceMember[],
  current?: { id: string; name: string } | null,
): Record<string, string> {
  const items: Record<string, string> = { [NO_ASSIGNEE]: 'Sem responsável' };
  for (const m of members) items[m.id] = m.name;
  if (current) items[current.id] = current.name;
  return items;
}
