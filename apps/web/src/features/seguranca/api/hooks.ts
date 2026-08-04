import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { segurancaApi } from './seguranca.api';
import type { Reautenticacao } from './types';

export function useStatusDoSegundoFator() {
  return useQuery({
    queryKey: queryKeys.auth.segundoFator,
    queryFn: () => segurancaApi.status(),
  });
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.auth.segundoFator });
}

/**
 * Inicia o cadastro. **Não** invalida o status: o setup não liga o 2FA, e
 * reconsultar aqui só faria a tela piscar "inativo" no meio do fluxo.
 */
export function useIniciarSegundoFator() {
  return useMutation({ mutationFn: () => segurancaApi.iniciar() });
}

export function useConfirmarSegundoFator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (codigo: string) => segurancaApi.confirmar(codigo),
    onSuccess: () => invalidar(qc),
  });
}

export function useRegenerarCodigos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Reautenticacao) => segurancaApi.regenerarCodigos(body),
    onSuccess: () => invalidar(qc),
  });
}

export function useDesativarSegundoFator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Reautenticacao) => segurancaApi.desativar(body),
    onSuccess: () => invalidar(qc),
  });
}
