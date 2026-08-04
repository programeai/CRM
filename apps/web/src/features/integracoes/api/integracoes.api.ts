import { api } from '@/lib/api';
import type {
  ChaveDeIntegracao,
  ChaveEmitida,
  CreateChaveBody,
  Escopo,
} from './types';

/**
 * `/integracoes/*` — a fronteira da chave de máquina, independente de quem a
 * emitiu (canal de captação ou a aba API). `rotacionarChave` continua em
 * `captacao.api.ts`: é o mesmo endpoint, e os dois consumidores reusam o
 * mesmo hook (`useRotacionarChave`).
 */
export const integracoesApi = {
  listEscopos: () => api.get<Escopo[]>('/integracoes/escopos').then((r) => r.data),
  listChaves: () =>
    api.get<ChaveDeIntegracao[]>('/integracoes/chaves').then((r) => r.data),
  /** Emite chave avulsa. Devolve o valor bruto — a única vez que ele existe. */
  criarChave: (body: CreateChaveBody) =>
    api.post<ChaveEmitida>('/integracoes/chaves', body).then((r) => r.data),
  /** Revoga sem apagar: a linha continua na lista, com o selo de revogada. */
  revogarChave: (id: string) =>
    api
      .delete<ChaveDeIntegracao>(`/integracoes/chaves/${id}`)
      .then((r) => r.data),
};
