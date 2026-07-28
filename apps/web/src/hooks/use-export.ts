import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { mensagemDoBlobDeErro } from '@/lib/api-error';

/**
 * Baixa uma exportação da API. O interceptor de resposta não toca o body, então
 * `responseType: 'blob'` funciona — mas o corpo de ERRO também vem como Blob, e
 * sem desembrulhá-lo o usuário veria "[object Blob]" no lugar da mensagem em
 * pt-BR (a do teto de 5.000 linhas, por exemplo).
 *
 * O download é um GET idempotente: se o 401 com refresh em fila reexecutar o
 * request original, o efeito é o mesmo arquivo, sem duplicação.
 */
export function useExport() {
  const [baixando, setBaixando] = useState(false);

  async function exportar(
    caminho: string,
    params: Record<string, unknown>,
    formato: 'csv' | 'xlsx',
    nomeBase: string,
  ) {
    setBaixando(true);
    try {
      const { data } = await api.get<Blob>(caminho, {
        params: { ...params, formato },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nomeBase}-${new Date().toISOString().slice(0, 10)}.${formato}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (erro) {
      toast.error(await mensagemDoBlobDeErro(erro));
    } finally {
      setBaixando(false);
    }
  }

  return { exportar, baixando };
}
