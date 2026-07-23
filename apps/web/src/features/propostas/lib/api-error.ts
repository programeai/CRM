import { isAxiosError } from 'axios';

export function extractApiMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(msg)) return msg[0] ?? fallback;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}
