import { api } from '@/lib/api';
// `Paginated` mora em `features/clientes/api/types` e é importado de lá por todas
// as features paginadas, inclusive a auditoria (audit.api.ts:2). Não é bonito —
// o tipo deveria estar em `lib/` — mas é o precedente, e mover o arquivo é uma
// mudança transversal que não pertence a esta fase.
import type { Paginated } from '@/features/clientes/api/types';
import type {
  AtualizarDestinoBody,
  CriarDestinoBody,
  CriarIntegracaoBody,
  DestinoDeNotificacao,
  Notificacao,
} from './types';

export const notificacoesApi = {
  list: (params: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<Paginated<Notificacao>>('/notifications', { params }).then((r) => r.data),
  unreadCount: () =>
    api.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  read: (id: string) =>
    api.post<{ ok: true }>(`/notifications/${id}/read`).then((r) => r.data),
  readAll: () =>
    api.post<{ updated: number }>('/notifications/read-all').then((r) => r.data),

  // --- destinos ---
  targets: () =>
    api.get<DestinoDeNotificacao[]>('/notifications/targets').then((r) => r.data),
  createTarget: (body: CriarDestinoBody) =>
    api
      .post<DestinoDeNotificacao>('/notifications/targets', body)
      .then((r) => r.data),
  updateTarget: (id: string, body: AtualizarDestinoBody) =>
    api
      .patch<DestinoDeNotificacao>(`/notifications/targets/${id}`, body)
      .then((r) => r.data),
  deleteTarget: (id: string) =>
    api.delete(`/notifications/targets/${id}`).then((r) => r.data),

  // --- integrações (webhook/slack): exigem `notificacao:integrar` ---
  createIntegration: (body: CriarIntegracaoBody) =>
    api
      .post<DestinoDeNotificacao>('/notifications/targets/integrations', body)
      .then((r) => r.data),
  verifyTarget: (id: string) =>
    api
      .post<DestinoDeNotificacao>(`/notifications/targets/${id}/verify`)
      .then((r) => r.data),
};
