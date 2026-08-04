import { api } from '@/lib/api';
import type {
  AtualizarWebhookBody,
  CriarWebhookBody,
  EventoDeWebhook,
  Webhook,
  WebhookComSegredo,
} from './types';

export const webhooksApi = {
  listEventos: () =>
    api.get<EventoDeWebhook[]>('/webhooks/eventos').then((r) => r.data),
  list: () => api.get<Webhook[]>('/webhooks').then((r) => r.data),
  /** Devolve o segredo de assinatura — a única vez que ele existe. */
  criar: (body: CriarWebhookBody) =>
    api.post<WebhookComSegredo>('/webhooks', body).then((r) => r.data),
  atualizar: (id: string, body: AtualizarWebhookBody) =>
    api.patch<Webhook>(`/webhooks/${id}`, body).then((r) => r.data),
  /** Ping de teste. Só depois dele o webhook entrega. */
  verificar: (id: string) =>
    api.post<Webhook>(`/webhooks/${id}/verify`).then((r) => r.data),
  /** Troca o segredo. A assinatura anterior para de casar na hora. */
  rotacionar: (id: string) =>
    api
      .post<WebhookComSegredo>(`/webhooks/${id}/rotate-secret`)
      .then((r) => r.data),
  excluir: (id: string) => api.delete(`/webhooks/${id}`).then((r) => r.data),
};
