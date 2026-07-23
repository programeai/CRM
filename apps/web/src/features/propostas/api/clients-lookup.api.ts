import { api } from '@/lib/api';

export interface ClientOption {
  id: string;
  name: string;
}
interface ClientsPage {
  data: ClientOption[];
}

/** Cópia local do lookup de clientes (evita importar o interior de `pipeline`). */
export const clientsLookupApi = {
  search: (search?: string) =>
    api
      .get<ClientsPage>('/clients', { params: { search: search || undefined, limit: 20 } })
      .then((r) => r.data.data),
};
