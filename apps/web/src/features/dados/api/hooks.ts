import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { dadosApi } from './dados.api';
import type { DecisaoDeOrigem, TipoDeImportacao } from './types';

export function usePreviaDeImportacao() {
  return useMutation({
    mutationFn: (params: {
      arquivo: File;
      tipo: TipoDeImportacao;
      mapeamento?: Record<string, string | null>;
    }) => {
      const form = new FormData();
      form.append('arquivo', params.arquivo);
      form.append('tipo', params.tipo);
      if (params.mapeamento) {
        form.append('mapeamento', JSON.stringify(params.mapeamento));
      }
      return dadosApi.previa(form);
    },
  });
}

export function useImportar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      arquivo: File;
      tipo: TipoDeImportacao;
      mapeamento: Record<string, string | null>;
      origens?: DecisaoDeOrigem[];
    }) => {
      const form = new FormData();
      form.append('arquivo', params.arquivo);
      form.append('tipo', params.tipo);
      form.append('mapeamento', JSON.stringify(params.mapeamento));
      if (params.origens?.length) {
        form.append('origens', JSON.stringify(params.origens));
      }
      return dadosApi.importar(form);
    },
    onSuccess: (relatorio) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients.all });
      if (relatorio.origensCriadas.length > 0) {
        void qc.invalidateQueries({ queryKey: queryKeys.catalogos.list('fontes-de-lead') });
      }
    },
  });
}
