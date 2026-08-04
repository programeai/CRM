/** Um item do catálogo de eventos (`GET /webhooks/eventos`). */
export interface EventoDeWebhook {
  key: string;
  label: string;
  description: string;
}

/**
 * Um webhook da workspace, como a API o devolve. **Nunca** traz o segredo, e da
 * URL traz só o `host`: o caminho completo é credencial (quem o tiver escreve no
 * endpoint).
 */
export interface Webhook {
  id: string;
  nome: string;
  host: string | null;
  eventos: string[];
  ativo: boolean;
  verificadoEm: string | null;
  ultimoUsoEm: string | null;
  criadoEm: string;
}

/** Resposta da criação e da rotação: a ÚNICA que carrega o segredo. */
export interface WebhookComSegredo {
  webhook: Webhook;
  /** Existe uma vez. Não é relido de lugar nenhum depois desta resposta. */
  segredo: string;
}

export interface CriarWebhookBody {
  nome: string;
  url: string;
  eventos: string[];
}

export interface AtualizarWebhookBody {
  nome?: string;
  url?: string;
  eventos?: string[];
  ativo?: boolean;
}
