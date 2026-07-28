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
  /** `false` na conta criada só por login social — não há senha a reconfirmar. */
  hasPassword: boolean;
  /** Encerramento agendado da workspace; `null` quando não há. */
  deletion: { requestedAt: string; scheduledFor: string } | null;
};

export type UpdateProfileBody = {
  name: string;
  email: string;
};

/** Sessão ativa do usuário (um dispositivo logado). */
export type Session = {
  id: string;
  /** Rótulo derivado do User-Agent pela API ("Chrome no Windows"). */
  device: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  /** `true` na sessão deste navegador — não pode ser revogada pela lista. */
  current: boolean;
};

export const perfilApi = {
  me: () => api.get<Me>('/auth/me').then((r) => r.data),
  update: (body: UpdateProfileBody) =>
    api.patch<Me>('/auth/me', body).then((r) => r.data),
  sessions: () => api.get<Session[]>('/auth/sessions').then((r) => r.data),
  revokeSession: (id: string) =>
    api.delete<{ ok: true }>(`/auth/sessions/${id}`).then((r) => r.data),
  revokeOtherSessions: () =>
    api.delete<{ revoked: number }>('/auth/sessions').then((r) => r.data),
};
