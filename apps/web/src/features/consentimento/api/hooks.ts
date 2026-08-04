import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { consentimentoApi } from './consentimento.api';
import type { RegistrarConsentimentoBody, TipoDeTitular } from './types';

/** Catálogo de finalidades — o front consome os rótulos daqui, não os duplica. */
export function useFinalidades() {
  return useQuery({
    queryKey: queryKeys.consentimentos.finalidades,
    queryFn: () => consentimentoApi.finalidades(),
  });
}

/**
 * O texto vigente da finalidade escolhida. `enabled` pela finalidade: sem ela
 * escolhida não há texto a buscar, e pedir texto de "nenhuma finalidade" seria
 * uma requisição garantidamente reprovada.
 */
export function useTextoDeConsentimento(purpose: string | null) {
  return useQuery({
    queryKey: queryKeys.consentimentos.texto(purpose ?? ''),
    queryFn: () => consentimentoApi.texto(purpose!),
    enabled: Boolean(purpose),
  });
}

export function useHistoricoDeConsentimento(
  subjectType: TipoDeTitular,
  subjectId: string,
) {
  return useQuery({
    queryKey: queryKeys.consentimentos.historico(subjectType, subjectId),
    queryFn: () => consentimentoApi.historico(subjectType, subjectId),
  });
}

export function useRegistrarConsentimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegistrarConsentimentoBody) =>
      consentimentoApi.registrar(body),
    onSuccess: (_r, body) =>
      qc.invalidateQueries({
        queryKey: queryKeys.consentimentos.historico(
          body.subjectType,
          body.subjectId,
        ),
      }),
  });
}
