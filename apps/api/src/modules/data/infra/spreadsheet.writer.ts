import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import writeXlsxFile from 'write-excel-file/node';
import type { ExportColumn } from '../../../shared/export';

/**
 * Célula de texto começando por estes caracteres é interpretada como fórmula
 * pelo Excel e pelo LibreOffice. Prefixar com apóstrofo neutraliza sem perder
 * o conteúdo. Vale só para texto: o valor numérico -100 é número, não fórmula.
 */
const GATILHOS_DE_FORMULA = ['=', '+', '-', '@', '\t', '\r'];

@Injectable()
export class SpreadsheetWriter {
  /** Delimitador `;` e BOM: é o que o Excel em pt-BR abre sem assistente de importação. */
  csv<T>(linhas: T[], colunas: ExportColumn<T>[]): Buffer {
    const registros = linhas.map((linha) =>
      colunas.map((coluna) => this.paraTextoCsv(coluna.value(linha))),
    );
    const texto = stringify(registros, {
      header: true,
      columns: colunas.map((c) => c.header),
      delimiter: ';',
      bom: true,
      record_delimiter: '\r\n',
    });
    return Buffer.from(texto, 'utf8');
  }

  /**
   * XLSX com tipo real por célula — data é data e número é número, então o
   * Excel soma e ordena sem o usuário reconverter nada. Sem escapatória de
   * fórmula: o XLSX distingue `t="s"` (texto) de fórmula na própria estrutura.
   */
  async xlsx<T>(linhas: T[], colunas: ExportColumn<T>[]): Promise<Buffer> {
    return writeXlsxFile(linhas, {
      columns: colunas.map((coluna) => ({
        header: coluna.header,
        width: coluna.width ?? 22,
        cell: (linha: T) => this.celulaXlsx(coluna.value(linha)),
      })),
    }).toBuffer();
  }

  private celulaXlsx(valor: string | number | Date | null) {
    if (valor === null || valor === '') return null;
    if (valor instanceof Date)
      return { value: valor, type: Date, format: 'dd/mm/yyyy' };
    if (typeof valor === 'number')
      return { value: valor, type: Number, format: '#,##0.00' };
    return { value: valor, type: String };
  }

  /** Texto pt-BR: data `dd/MM/aaaa`, decimal com vírgula, fórmula neutralizada. */
  private paraTextoCsv(valor: string | number | Date | null): string {
    if (valor === null) return '';
    if (valor instanceof Date) return valor.toLocaleDateString('pt-BR');
    if (typeof valor === 'number')
      return valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    return GATILHOS_DE_FORMULA.some((g) => valor.startsWith(g))
      ? `'${valor}`
      : valor;
  }
}
