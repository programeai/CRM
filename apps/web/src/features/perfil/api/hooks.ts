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
