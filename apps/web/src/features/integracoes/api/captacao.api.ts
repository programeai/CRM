import { api } from '@/lib/api';
import type {
  CanalBody,
  CanalCriado,
  CanalDeCaptacao,
  ChaveEmitida,
} from './types';

export const captacaoApi = {
  listCanais: () =>
    api.get<CanalDeCaptacao[]>('/leads/canais').then((r) => r.data),
  /** Devolve o valor bruto da chave — a única vez que ele existe. */
  createCanal: (body: CanalBody) =>
    api.post<CanalCriado>('/leads/canais', body).then((r) => r.data),
  updateCanal: (id: string, body: Partial<CanalBody>) =>
    api.patch<CanalDeCaptacao>(`/leads/canais/${id}`, body).then((r) => r.data),
  deleteCanal: (id: string) =>
    api.delete(`/leads/canais/${id}`).then((r) => r.data),

  /** Troca o segredo da mesma chave. A anterior morre na hora. */
  rotacionarChave: (id: string) =>
    api
      .post<ChaveEmitida>(`/integracoes/chaves/${id}/rotacionar`)
      .then((r) => r.data),
};
