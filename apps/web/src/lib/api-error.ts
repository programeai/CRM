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

/**
 * Extrai a mensagem pt-BR de uma resposta de erro que veio como `Blob` — o
 * corpo de erro de um download (`responseType: 'blob'`) não passa pelo
 * interceptor de JSON comum. Usado por `useExport` e `useDownload`.
 */
export async function mensagemDoBlobDeErro(erro: unknown): Promise<string> {
  const corpo = (erro as { response?: { data?: unknown } })?.response?.data;
  if (corpo instanceof Blob) {
    try {
      const { message } = JSON.parse(await corpo.text());
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(' ');
    } catch {
      /* corpo não-JSON cai no genérico */
    }
  }
  return 'Falha ao baixar o arquivo. Tente de novo.';
}
