import { UnprocessableEntityException } from '@nestjs/common';
import { SpreadsheetReader, MAX_IMPORT_ROWS } from './spreadsheet.reader';
import { SpreadsheetWriter } from './spreadsheet.writer';
import type { ExportColumn } from '../../../shared/export';

describe('SpreadsheetReader', () => {
  const reader = new SpreadsheetReader(); // classe de infraestrutura → instancia de verdade

  describe('CSV', () => {
    it('lê cabeçalho e linhas com `;` e remove o BOM do primeiro cabeçalho', async () => {
      const csv = '﻿Nome;E-mail\r\nAcme;contato@acme.com\r\n';
      const planilha = await reader.ler(Buffer.from(csv, 'utf8'));
      expect(planilha.colunas).toEqual(['Nome', 'E-mail']);
      expect(planilha.linhas).toEqual([
        { Nome: 'Acme', 'E-mail': 'contato@acme.com' },
      ]);
    });

    it('detecta o delimitador `,` quando é o mais frequente no cabeçalho', async () => {
      const csv = 'Nome,E-mail\nAcme,contato@acme.com\n';
      const planilha = await reader.ler(Buffer.from(csv, 'utf8'));
      expect(planilha.colunas).toEqual(['Nome', 'E-mail']);
      expect(planilha.linhas).toEqual([
        { Nome: 'Acme', 'E-mail': 'contato@acme.com' },
      ]);
    });

    it('preserva o `;` dentro de um campo entre aspas', async () => {
      const csv = 'Nome;Observações\r\nAcme;"Rua A; sala 2"\r\n';
      const planilha = await reader.ler(Buffer.from(csv, 'utf8'));
      expect(planilha.linhas[0]).toEqual({
        Nome: 'Acme',
        Observações: 'Rua A; sala 2',
      });
    });

    it('lança 422 quando o cabeçalho tem coluna sem nome', async () => {
      const csv = 'Nome;;E-mail\r\nAcme;x;contato@acme.com\r\n';
      await expect(reader.ler(Buffer.from(csv, 'utf8'))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('lança 422 quando o cabeçalho tem nome repetido', async () => {
      const csv = 'Nome;Nome\r\nAcme;Acme2\r\n';
      await expect(reader.ler(Buffer.from(csv, 'utf8'))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('lança 422 citando 500 e 501 quando o arquivo tem 501 linhas de dado', async () => {
      const linhas = Array.from(
        { length: MAX_IMPORT_ROWS + 1 },
        (_, i) => `Cliente ${i}`,
      );
      const csv = 'Nome\r\n' + linhas.join('\r\n') + '\r\n';
      await expect(reader.ler(Buffer.from(csv, 'utf8'))).rejects.toThrow(
        /500.*501|501.*500/s,
      );
    });

    it('lança 422 quando só há cabeçalho', async () => {
      const csv = 'Nome;E-mail\r\n';
      await expect(reader.ler(Buffer.from(csv, 'utf8'))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('ignora linha em branco no meio do arquivo (não conta para o teto)', async () => {
      const csv = 'Nome\r\nAcme\r\n\r\nBeta\r\n';
      const planilha = await reader.ler(Buffer.from(csv, 'utf8'));
      expect(planilha.linhas).toHaveLength(2);
      expect(planilha.linhas).toEqual([{ Nome: 'Acme' }, { Nome: 'Beta' }]);
    });
  });

  describe('XLSX', () => {
    it('lê de volta um XLSX produzido pelo SpreadsheetWriter (ida e volta)', async () => {
      interface Linha {
        nome: string;
        idade: number;
      }
      const writer = new SpreadsheetWriter();
      const colunas: ExportColumn<Linha>[] = [
        { header: 'Nome', value: (l) => l.nome },
        { header: 'Idade', value: (l) => l.idade },
      ];
      const buffer = await writer.xlsx<Linha>(
        [{ nome: 'Acme', idade: 10 }],
        colunas,
      );
      const planilha = await reader.ler(buffer);
      expect(planilha.colunas).toEqual(['Nome', 'Idade']);
      expect(planilha.linhas[0].Nome).toBe('Acme');
      expect(planilha.linhas[0].Idade).toBe('10');
    });
  });
});
