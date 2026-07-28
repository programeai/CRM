import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportService } from '../application/import.service';
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { RequirePermission } from '../../access/require-permission.decorator';
import { ImportPreviaDto } from './dto/import-previa.dto';
import { ImportCommitDto } from './dto/import-commit.dto';
import type {
  DecisaoDeOrigem,
  PreviaDeImportacao,
  RelatorioDeImportacao,
} from '../domain/import';

@Controller('data/import')
export class ImportController {
  constructor(private readonly importacao: ImportService) {}

  /**
   * Prévia da importação. NÃO grava nada — é a etapa onde o usuário confere o
   * mapeamento e decide o que fazer com as origens que não estão no catálogo
   * dele. Exige a mesma chave da gravação porque a prévia lê a base de clientes
   * do owner para casar contatos.
   */
  @RequirePermission('dados:importar')
  @Post('previa')
  @UseInterceptors(
    FileInterceptor('arquivo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  previa(
    @CurrentOwnerId() ownerId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() dto: ImportPreviaDto,
  ): Promise<PreviaDeImportacao> {
    if (!arquivo) {
      throw new BadRequestException('Envie um arquivo CSV ou XLSX.');
    }
    return this.importacao.previa(
      ownerId,
      dto.tipo,
      arquivo.buffer,
      parseMapeamento(dto.mapeamento),
    );
  }

  /**
   * Commit da importação. Grava dentro da transação do request — ou o
   * arquivo inteiro entra, ou nada entra. Exige o mesmo `mapeamento` que a
   * prévia sugeriu/confirmou e a decisão sobre cada origem desconhecida.
   */
  @RequirePermission('dados:importar')
  @Post()
  @UseInterceptors(
    FileInterceptor('arquivo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  importar(
    @CurrentAccess() access: AccessContext,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() dto: ImportCommitDto,
  ): Promise<RelatorioDeImportacao> {
    if (!arquivo) {
      throw new BadRequestException('Envie um arquivo CSV ou XLSX.');
    }
    return this.importacao.importar(
      access.ownerId,
      dto.tipo,
      arquivo.buffer,
      parseMapeamento(dto.mapeamento) ?? {},
      parseOrigens(dto.origens),
      arquivo.originalname,
      // Criar item de catálogo pela importação continua sendo ato de
      // catálogo: a fronteira de `catalogo:gerenciar` não se dissolve porque
      // a escrita veio por outra porta.
      access.permissions.includes('catalogo:gerenciar'),
    );
  }
}

/**
 * `JSON.parse` protegido: um corpo mal formado responde `400` em pt-BR em vez
 * de deixar o `SyntaxError` virar `500`.
 */
export function parseMapeamento(
  bruto: string | undefined,
): Record<string, string | null> | undefined {
  if (bruto === undefined) return undefined;
  try {
    return JSON.parse(bruto) as Record<string, string | null>;
  } catch {
    throw new BadRequestException('O mapeamento de colunas está mal formado.');
  }
}

/** `JSON.parse` protegido para a decisão sobre as origens desconhecidas. */
export function parseOrigens(bruto: string | undefined): DecisaoDeOrigem[] {
  if (bruto === undefined) return [];
  try {
    return JSON.parse(bruto) as DecisaoDeOrigem[];
  } catch {
    throw new BadRequestException(
      'A decisão sobre as origens desconhecidas está mal formada.',
    );
  }
}
