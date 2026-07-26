import { api } from '@/lib/api';

export type Me = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  /** `true` para o dono da conta: acesso total, sem papel atribuído. */
  isOwner: boolean;
  /** Papel do colaborador; `null` no owner. */
  role: { id: string; name: string } | null;
  /**
   * Chaves de permissão efetivas (catálogo em `GET /permissions`). É a fonte de
   * verdade do gating na interface — ver `useCan`.
   */
  permissions: string[];
};

export type UpdateProfileBody = {
  name: string;
  email: string;
};

export const perfilApi = {
  me: () => api.get<Me>('/auth/me').then((r) => r.data),
  update: (body: UpdateProfileBody) =>
    api.patch<Me>('/auth/me', body).then((r) => r.data),
};
