import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface ClientOption {
  id: string;
  name: string;
}
interface ClientsPage {
  data: ClientOption[];
}

/** Lookup transversal de clientes usado pelos seletores (combobox) das features. */
export const clientsLookupApi = {
  search: (search?: string) =>
    api
      .get<ClientsPage>('/clients', { params: { search: search || undefined, limit: 20 } })
      .then((r) => r.data.data),
};

/** Busca clientes para popular seletores; a chave de cache é compartilhada entre features. */
export function useClientOptions(search: string) {
  return useQuery({
    queryKey: queryKeys.clientOptions(search),
    queryFn: () => clientsLookupApi.search(search),
  });
}

/**
 * Mapa id→nome que o `Select` (base-ui) usa para exibir o nome do cliente selecionado
 * no gatilho — sem ele, o gatilho mostra o id cru. Inclui o cliente já selecionado
 * (`selected`), que pode não estar na lista de busca atual (ex.: edição).
 */
export function buildClientItems(
  choices: ClientOption[],
  selected?: ClientOption | null,
): Record<string, string> {
  const items: Record<string, string> = {};
  for (const c of choices) items[c.id] = c.name;
  if (selected) items[selected.id] = selected.name;
  return items;
}
