import { isAxiosError } from 'axios';

/**
 * Mensagem de erro da API pronta para exibir (já vem em pt-BR do backend),
 * com fallback quando a resposta não trouxer `message`.
 */
export function extractApiMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(msg)) return msg[0] ?? fallback;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}
