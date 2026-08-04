import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Tabela de referência de uma página de ajuda: campos do payload, cabeçalhos,
 * códigos de resposta. Rola na horizontal no celular em vez de embrulhar, como
 * as tabelas de dados do resto do app.
 */
export function TabelaDoc({
  colunas,
  linhas,
}: {
  colunas: string[];
  /** Uma célula por coluna, na mesma ordem. */
  linhas: ReactNode[][];
}) {
  return (
    <div className="rounded-lg border">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {colunas.map((coluna) => (
                <TableHead key={coluna}>{coluna}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((linha, i) => (
              <TableRow key={i}>
                {linha.map((celula, j) => (
                  <TableCell key={j} className="align-top text-sm">
                    {celula}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
