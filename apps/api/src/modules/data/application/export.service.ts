import { Injectable, StreamableFile } from '@nestjs/common';
import type { ExportColumn, ExportFormat } from '../../../shared/export';
import { SpreadsheetWriter } from '../infra/spreadsheet.writer';

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

@Injectable()
export class ExportService {
  constructor(private readonly writer: SpreadsheetWriter) {}

  /**
   * Serializa as linhas que o módulo dono já filtrou. Devolve `StreamableFile`
   * sobre um Buffer **já pronto**: quando o interceptor commita a transação do
   * request, não há mais trabalho de banco pendente — é o que impede o download
   * de segurar a transação aberta.
   */
  async gerar<T>(
    linhas: T[],
    colunas: ExportColumn<T>[],
    formato: ExportFormat,
    nomeBase: string,
  ): Promise<StreamableFile> {
    const buffer =
      formato === 'csv'
        ? this.writer.csv(linhas, colunas)
        : await this.writer.xlsx(linhas, colunas);
    const dia = new Date().toISOString().slice(0, 10);
    return new StreamableFile(buffer, {
      type: CONTENT_TYPE[formato],
      disposition: `attachment; filename="${nomeBase}-${dia}.${formato}"`,
      length: buffer.byteLength,
    });
  }
}
