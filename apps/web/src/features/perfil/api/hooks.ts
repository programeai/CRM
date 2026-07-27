import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { perfilApi } from './perfil.api';
import type { Me, UpdateProfileBody } from './perfil.api';

export function useMe() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => perfilApi.me(),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileBody) => perfilApi.update(body),
    onSuccess: (data: Me) => {
      qc.setQueryData(queryKeys.auth.me, data);
    },
  });
}

export function useSessions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.auth.sessions,
    queryFn: () => perfilApi.sessions(),
    enabled: options?.enabled ?? true,
  });
}

function invalidateSessions(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.auth.sessions });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => perfilApi.revokeSession(id),
    onSuccess: () => invalidateSessions(qc),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => perfilApi.revokeOtherSessions(),
    onSuccess: () => invalidateSessions(qc),
  });
}
