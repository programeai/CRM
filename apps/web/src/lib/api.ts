import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, setAccessToken } from './auth-store';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  // Serializa arrays como chaves repetidas (`status=A&status=B`), sem `[]`.
  // O Express 5 (query parser `simple`) só entende esse formato como array —
  // o formato padrão `status[]=A` viraria a chave literal `status[]`.
  paramsSerializer: { indexes: null },
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let queue: Array<(t: string | null) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    // 402 (assinatura inativa) não redireciona: o gate só barra escrita, e
    // arrastar quem está lendo para o paywall custaria o formulário aberto. A
    // mensagem em pt-BR do backend já explica o bloqueio pelo toast da tela, e o
    // caminho para assinar fica no aviso fixo do `SubscriptionBlockedNotice`.
    const isRefreshCall = original?.url?.includes('/auth/refresh');
    if (error.response?.status !== 401 || original._retry || isRefreshCall) {
      return Promise.reject(error);
    }
    original._retry = true;
    const retry = new Promise((resolve, reject) => {
      queue.push((t) => {
        if (!t) return reject(error);
        original.headers.Authorization = `Bearer ${t}`;
        resolve(api(original));
      });
    });
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.accessToken);
        queue.forEach((cb) => cb(data.accessToken));
      } catch {
        setAccessToken(null);
        queue.forEach((cb) => cb(null));
        window.location.href = '/login';
      } finally {
        queue = [];
        isRefreshing = false;
      }
    }
    return retry;
  },
);
