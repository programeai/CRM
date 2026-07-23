import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { proposalsApi } from './proposals.api';
import { clientsLookupApi } from './clients-lookup.api';
import type { CreateProposalBody, ListProposalsParams, UpdateProposalBody } from './types';

export function useProposals(params: ListProposalsParams) {
  return useQuery({
    queryKey: queryKeys.proposals.list(params),
    queryFn: () => proposalsApi.list(params),
  });
}
export function useProposalsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.proposals.byClient(clientId),
    queryFn: () => proposalsApi.listByClient(clientId),
  });
}
export function useProposal(id: string) {
  return useQuery({
    queryKey: queryKeys.proposals.detail(id),
    queryFn: () => proposalsApi.get(id),
    enabled: !!id,
  });
}
export function useProposalVersions(id: string) {
  return useQuery({
    queryKey: queryKeys.proposals.versions(id),
    queryFn: () => proposalsApi.versions(id),
    enabled: !!id,
  });
}
export function useClientOptions(search: string) {
  return useQuery({
    queryKey: queryKeys.clientOptions(search),
    queryFn: () => clientsLookupApi.search(search),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.proposals.all });
}
export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProposalBody) => proposalsApi.create(body),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useUpdateProposal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProposalBody) => proposalsApi.update(id, body),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useDeleteProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => proposalsApi.remove(id),
    onSuccess: () => invalidateAll(qc),
  });
}
/** Ações de status: send/accept/reject/new-version. Aceite também invalida deals. */
export function useProposalAction(action: 'send' | 'accept' | 'reject' | 'newVersion') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => proposalsApi[action](id),
    onSuccess: () => {
      invalidateAll(qc);
      if (action === 'accept') void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
    },
  });
}
