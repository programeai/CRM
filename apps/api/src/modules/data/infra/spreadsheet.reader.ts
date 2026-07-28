import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { readSheet } from 'read-excel-file/node';

/**
 * Teto de linhas de dados por importação. A escrita acontece dentro da
 * transação do request, que tem 5s de orçamento e NÃO permite commit parcial —
 * ou o arquivo inteiro entra, ou nada entra. 500 é o que cabe com folga; acima
 * disso o usuário divide o arquivo.
 *
 * O teto é aplicado no PARSE, não depois: `limits.fileSize` do multer não
 * protege contra um xlsx de 200 KB que descomprime para gigabytes.
 */
export const MAX_IMPORT_ROWS = 500;

/** Assinatura de zip — todo .xlsx é um zip. Não se confia no Content-Type. */
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface PlanilhaLida {
  /** Cabeçalhos da primeira linha, na ordem original. */
  colunas: string[];
  /** Linhas de dados, indexadas pelo cabeçalho. Tudo já em texto e com trim. */
  linhas: Record<string, string>[];
}

@Injectable()
export class SpreadsheetReader {
  async ler(arquivo: Buffer): Promise<PlanilhaLida> {
    const bruto = this.ehXlsx(arquivo)
      ? await this.lerXlsx(arquivo)
      : this.lerCsv(arquivo);
    return this.montar(bruto);
  }

  private ehXlsx(arquivo: Buffer): boolean {
    return arquivo.subarray(0, 4).equals(ASSINATURA_ZIP);
  }

  /**
   * `readSheet` (não o `readXlsxFile` default, que devolve TODAS as abas como
   * `{ sheet, data }[]`) lê a primeira aba e devolve `SheetData` (`Row[]`) direto
   * — é o formato que `montar` espera.
   */
  private async lerXlsx(arquivo: Buffer): Promise<string[][]> {
    const linhas = await readSheet(arquivo);
    return linhas.map((linha) => linha.map((c) => this.paraTexto(c)));
  }

  /**
   * Delimitador decidido pelo cabeçalho: planilha salva pelo Excel em pt-BR usa
   * `;`, exportação de ferramenta gringa usa `,`. Errar isso devolve uma coluna
   * só com o arquivo inteiro dentro, e o usuário não teria como diagnosticar.
   */
  private lerCsv(arquivo: Buffer): string[][] {
    const texto = arquivo.toString('utf8').replace(/^\uFEFF/, '');
    const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
    const delimiter =
      (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0)
        ? ';'
        : ',';
    return parse(texto, {
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  }

  private montar(bruto: string[][]): PlanilhaLida {
    const [cabecalho, ...corpo] = bruto;
    if (!cabecalho?.length) {
      throw new UnprocessableEntityException(
        'A planilha está vazia ou não tem uma linha de cabeçalho.',
      );
    }
    const colunas = cabecalho.map((c) => c.trim());
    if (colunas.some((c) => c === '')) {
      throw new UnprocessableEntityException(
        'A primeira linha da planilha tem uma coluna sem nome. Dê um nome a todas as colunas do cabeçalho.',
      );
    }
    const repetida = colunas.find((c, i) => colunas.indexOf(c) !== i);
    if (repetida) {
      throw new UnprocessableEntityException(
        `A planilha tem duas colunas com o nome "${repetida}". Renomeie uma delas.`,
      );
    }
    // Linha totalmente vazia no meio do arquivo é ruído de planilha, não erro.
    const uteis = corpo.filter((l) => l.some((c) => c.trim() !== ''));
    if (uteis.length === 0) {
      throw new UnprocessableEntityException(
        'A planilha não tem nenhuma linha de dados abaixo do cabeçalho.',
      );
    }
    if (uteis.length > MAX_IMPORT_ROWS) {
      throw new UnprocessableEntityException(
        `A importação é limitada a ${MAX_IMPORT_ROWS} linhas por arquivo e esta planilha tem ${uteis.length}. Divida o arquivo e importe em partes.`,
      );
    }
    return {
      colunas,
      linhas: uteis.map((linha) =>
        Object.fromEntries(
          colunas.map((coluna, i) => [coluna, (linha[i] ?? '').trim()]),
        ),
      ),
    };
  }

  /**
   * Célula do xlsx → texto. Data vira `dd/MM/aaaa`, como o usuário digitaria.
   * `celula` é `unknown` porque o `.d.ts` do `read-excel-file` tipa a união de
   * valor com `typeof Date` (o construtor) em vez de `Date` (a instância) — o
   * `instanceof Date` abaixo lida com o valor real que a lib devolve em tempo
   * de execução; os outros ramos são primitivos, seguros para `String(...)`.
   */
  private paraTexto(celula: unknown): string {
    if (celula === null || celula === undefined) return '';
    if (celula instanceof Date) return celula.toLocaleDateString('pt-BR');
    if (typeof celula === 'string') return celula.trim();
    if (typeof celula === 'number' || typeof celula === 'boolean') {
      return String(celula);
    }
    return '';
  }
}
