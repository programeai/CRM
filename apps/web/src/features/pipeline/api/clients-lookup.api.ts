import { api } from '@/lib/api';

export interface ClientOption {
  id: string;
  name: string;
}
interface ClientsPage {
  data: ClientOption[];
}

export const clientsLookupApi = {
  search: (search?: string) =>
    api
      .get<ClientsPage>('/clients', { params: { search: search || undefined, limit: 20 } })
      .then((r) => r.data.data),
};
