import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useExport } from '@/hooks/use-export';

/**
 * Botão "Exportar" das toolbars de listagem. `params` é o MESMO objeto que
 * alimenta a query da tela — é assim que a planilha respeita o filtro sem uma
 * segunda montagem. Sem gate de permissão: quem está na tela já passou pelo
 * `PermissionRoute` dela, e a API é a autoridade.
 */
export function ExportButton({
  caminho,
  params,
  nomeBase,
}: {
  caminho: string;
  params: Record<string, unknown>;
  nomeBase: string;
}) {
  const { exportar, baixando } = useExport();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={baixando} />}>
        {baixando ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
        Exportar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void exportar(caminho, params, 'csv', nomeBase)}>
          CSV (.csv)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportar(caminho, params, 'xlsx', nomeBase)}>
          Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
