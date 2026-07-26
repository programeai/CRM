import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type RegistrationStatus = { enabled: boolean };

/**
 * Se o autocadastro está aberto nesta instância (`REGISTRATION_ENABLED` na API).
 * `undefined` enquanto carrega — quem consome trata isso como "ainda não sei" e
 * não pisca a tela de bloqueio.
 */
export function useRegistrationEnabled(): boolean | undefined {
  const { data } = useQuery<RegistrationStatus>({
    queryKey: queryKeys.auth.registration,
    queryFn: async () => (await api.get('/auth/registration')).data,
    staleTime: 5 * 60 * 1000,
  });
  return data?.enabled;
}
