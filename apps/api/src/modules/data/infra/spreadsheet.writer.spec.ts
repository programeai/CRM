import { SpreadsheetWriter } from './spreadsheet.writer';
import type { ExportColumn } from '../../../shared/export';

interface Linha {
  texto: string;
  numero: number;
  data: Date | null;
  vazio: null;
}

const COLUNAS: ExportColumn<Linha>[] = [
  { header: 'Texto', value: (l) => l.texto },
  { header: 'Número', value: (l) => l.numero },
  { header: 'Data', value: (l) => l.data },
  { header: 'Vazio', value: (l) => l.vazio },
];

describe('SpreadsheetWriter', () => {
  const writer = new SpreadsheetWriter(); // classe de infraestrutura → instancia de verdade

  describe('csv', () => {
    it('começa com BOM e usa `;` como delimitador', () => {
      const buffer = writer.csv<Linha>(
        [{ texto: 'Acme', numero: 10, data: null, vazio: null }],
        COLUNAS,
      );
      const texto = buffer.toString('utf8');
      expect(texto.charCodeAt(0)).toBe(0xfeff); // BOM
      expect(texto).toContain('Texto;Número;Data;Vazio');
    });

    it('neutraliza célula de texto que parece fórmula, sem tocar em número negativo', () => {
      const buffer = writer.csv<Linha>(
        [
          {
            texto: '=SOMA(A1:A9)',
            numero: -1500,
            data: null,
            vazio: null,
          },
        ],
        COLUNAS,
      );
      const texto = buffer.toString('utf8');
      expect(texto).toContain("'=SOMA(A1:A9)");
      expect(texto).toContain('-1.500,00');
      expect(texto).not.toContain("'-1.500,00");
    });

    it('formata data como dd/MM/aaaa', () => {
      const buffer = writer.csv<Linha>(
        [
          {
            texto: 'x',
            numero: 0,
            data: new Date(2026, 6, 28),
            vazio: null,
          },
        ],
        COLUNAS,
      );
      expect(buffer.toString('utf8')).toContain('28/07/2026');
    });

    it('devolve célula vazia para null', () => {
      const buffer = writer.csv<Linha>(
        [{ texto: 'x', numero: 0, data: null, vazio: null }],
        COLUNAS,
      );
      const texto = buffer.toString('utf8');
      const linhas = texto.replace(/^\uFEFF/, '').split('\r\n');
      expect(linhas[1]).toBe('x;0,00;;');
    });
  });

  describe('xlsx', () => {
    it('produz um buffer com assinatura de zip e tamanho > 0', async () => {
      const buffer = await writer.xlsx<Linha>(
        [{ texto: 'Acme', numero: 10, data: new Date(), vazio: null }],
        COLUNAS,
      );
      expect(buffer.subarray(0, 4)).toEqual(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      );
      expect(buffer.byteLength).toBeGreaterThan(0);
    });
  });
});
