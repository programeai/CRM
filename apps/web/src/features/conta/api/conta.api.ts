import { api } from '@/lib/api';

export type EncerramentoAgendado = {
  requestedAt: string;
  scheduledFor: string;
};

export const contaApi = {
  solicitarEncerramento: (body: { password?: string; email?: string }) =>
    api
      .post<EncerramentoAgendado>('/account/deletion', body)
      .then((r) => r.data),
  cancelarEncerramento: () =>
    api.delete<{ ok: true }>('/account/deletion').then((r) => r.data),
};
