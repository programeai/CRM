import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { mensagemDoBlobDeErro } from '@/lib/api-error';

/**
 * Baixa um arquivo de uma rota GET da API, sem query de formato — o irmão do
 * `useExport`, que é específico de planilha (csv/xlsx + params de filtro). Mesma
 * mecânica de Blob e o mesmo desembrulho da mensagem pt-BR do corpo de erro.
 */
export function useDownload() {
  const [baixando, setBaixando] = useState(false);

  async function baixar(caminho: string, nomeArquivo: string) {
    setBaixando(true);
    try {
      const { data } = await api.get<Blob>(caminho, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      a.click();
      URL.revokeObjectURL(url);
    } catch (erro) {
      toast.error(await mensagemDoBlobDeErro(erro));
    } finally {
      setBaixando(false);
    }
  }

  return { baixar, baixando };
}
