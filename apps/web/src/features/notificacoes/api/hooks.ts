import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { notificacoesApi } from './notificacoes.api';
import type {
  AtualizarDestinoBody,
  CriarDestinoBody,
  CriarIntegracaoBody,
} from './types';

/** Sem SSE nem WebSocket (D3): a contagem se atualiza por polling. */
const INTERVALO_MS = 45_000;

/** Quantos itens o popover carrega. Não há "ver todas" nesta fase. */
const LIMITE_DO_POPOVER = 10;

export function useNaoLidas() {
  return useQuery({
    queryKey: queryKeys.notificacoes.unreadCount,
    queryFn: () => notificacoesApi.unreadCount(),
    // SÓ AQUI. O QueryClient é criado sem `defaultOptions` (main.tsx:13) e assim
    // deve continuar — pôr refetchInterval global faria a aplicação inteira
    // repolar. Este é o único hook com custo de polling do projeto.
    refetchInterval: INTERVALO_MS,
  });
}

export function useNotificacoes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.notificacoes.list({ limit: LIMITE_DO_POPOVER }),
    queryFn: () => notificacoesApi.list({ limit: LIMITE_DO_POPOVER }),
    // Só busca a lista quando o popover abre — evita requisição a cada tela.
    enabled: options?.enabled ?? true,
  });
}

function invalidateNotificacoes(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.notificacoes.all });
}

export function useMarcarLida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificacoesApi.read(id),
    onSuccess: () => invalidateNotificacoes(qc),
  });
}

export function useMarcarTodasLidas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificacoesApi.readAll(),
    onSuccess: () => invalidateNotificacoes(qc),
  });
}

// --- destinos ---

export function useDestinos(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.notificacoes.targets,
    queryFn: () => notificacoesApi.targets(),
    enabled: options?.enabled ?? true,
  });
}

function invalidateDestinos(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.notificacoes.targets });
}

export function useCriarDestino() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CriarDestinoBody) => notificacoesApi.createTarget(body),
    onSuccess: () => invalidateDestinos(qc),
  });
}

export function useAtualizarDestino() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AtualizarDestinoBody }) =>
      notificacoesApi.updateTarget(id, body),
    onSuccess: () => invalidateDestinos(qc),
  });
}

export function useExcluirDestino() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificacoesApi.deleteTarget(id),
    onSuccess: () => invalidateDestinos(qc),
  });
}

export function useCriarIntegracao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CriarIntegracaoBody) =>
      notificacoesApi.createIntegration(body),
    onSuccess: () => invalidateDestinos(qc),
  });
}

export function useVerificarDestino() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificacoesApi.verifyTarget(id),
    onSuccess: () => invalidateDestinos(qc),
  });
}

/**
 * Troca o segredo de assinatura do destino de webhook. Não invalida a lista: a
 * resposta não muda nada de exibível — o segredo nunca aparece em
 * `GET /targets`, e é a tela que mostra o valor novo uma única vez.
 */
export function useRotacionarSegredo() {
  return useMutation({
    mutationFn: (id: string) => notificacoesApi.rotateSecret(id),
  });
}
