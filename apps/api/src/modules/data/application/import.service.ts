import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CatalogItem } from '../../catalogos/domain/catalog.repository';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import { SpreadsheetReader } from '../infra/spreadsheet.reader';
import { CatalogResolver } from './catalog-resolver';
import { ClientsService } from '../../clients/application/clients.service';
import { ContactsService } from '../../contacts/application/contacts.service';
import { AuditService } from '../../audit/audit.service';
import {
  camposDe,
  type DecisaoDeOrigem,
  type PreviaDeImportacao,
  type RelatorioDeImportacao,
  type TipoDeImportacao,
} from '../domain/import';
import {
  aplicar,
  assertMapeamentoCompleto,
  indexarClientes,
  indexarDocumentosNoArquivo,
  resolverCliente,
  sugerirMapeamento,
  validarLinha,
  type ClientesIndexados,
} from './import-rules';
import {
  construirDtoDeCliente,
  construirDtoDeContato,
} from './import-dto-builder';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly reader: SpreadsheetReader,
    private readonly resolver: CatalogResolver,
    private readonly clients: ClientsService,
    private readonly contacts: ContactsService,
    private readonly catalogos: CatalogosService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Prévia da importação. NÃO grava nada — é onde o usuário confere o
   * mapeamento e decide o que fazer com as origens que não estão no catálogo
   * dele. Lê a base de clientes do owner só para `contatos` (casar o pai).
   */
  async previa(
    ownerId: string,
    tipo: TipoDeImportacao,
    arquivo: Buffer,
    mapeamentoInformado?: Record<string, string | null>,
  ): Promise<PreviaDeImportacao> {
    const planilha = await this.reader.ler(arquivo);
    const campos = camposDe(tipo);
    const mapeamento =
      mapeamentoInformado ?? sugerirMapeamento(planilha.colunas, campos);
    assertMapeamentoCompleto(tipo, mapeamento, campos);

    const catalogo = await this.resolver.carregar(ownerId);
    const clientes = await this.carregarClientesSeNecessario(ownerId, tipo);

    const linhas = planilha.linhas.map((bruta) => aplicar(bruta, mapeamento));
    const documentosNoArquivo = indexarDocumentosNoArquivo(linhas);
    const erros = linhas.flatMap((linha, i) =>
      validarLinha(tipo, linha, i + 2, catalogo, clientes, documentosNoArquivo),
    );
    const origensDesconhecidas =
      tipo === 'clientes'
        ? catalogo.desconhecidos(
            linhas.map((l) => l.sourceId ?? '').filter(Boolean),
          )
        : [];

    return {
      tipo,
      totalDeLinhas: linhas.length,
      colunas: planilha.colunas,
      campos,
      mapeamento,
      amostra: linhas.slice(0, 10),
      origensDesconhecidas,
      erros,
      validas: linhas.length - new Set(erros.map((e) => e.linha)).size,
    };
  }

  /**
   * Grava a planilha. Tudo dentro da transação do request: ou o arquivo
   * inteiro entra, ou nada entra — `prisma.db` é `Prisma.TransactionClient`,
   * sem `$transaction` aninhado.
   *
   * O arquivo é reprocessado do zero (a prévia não persiste), então a
   * validação roda de novo aqui: entre a prévia e o commit alguém pode ter
   * cadastrado um cliente com o mesmo documento.
   */
  async importar(
    ownerId: string,
    tipo: TipoDeImportacao,
    arquivo: Buffer,
    mapeamento: Record<string, string | null>,
    origens: DecisaoDeOrigem[],
    nomeArquivo: string,
    podeGerenciarCatalogo: boolean,
  ): Promise<RelatorioDeImportacao> {
    const inicio = Date.now();
    const planilha = await this.reader.ler(arquivo);
    const campos = camposDe(tipo);
    assertMapeamentoCompleto(tipo, mapeamento, campos);

    const catalogo = await this.resolver.carregar(ownerId);
    const { criadas, ignoradas } = await this.aplicarDecisoesDeOrigem(
      ownerId,
      origens,
      catalogo,
      podeGerenciarCatalogo,
    );

    const clientes = await this.carregarClientesSeNecessario(ownerId, tipo);
    const linhas = planilha.linhas.map((bruta) => aplicar(bruta, mapeamento));
    const documentosNoArquivo = indexarDocumentosNoArquivo(linhas);
    const erros = linhas.flatMap((linha, i) =>
      validarLinha(tipo, linha, i + 2, catalogo, clientes, documentosNoArquivo),
    );
    if (erros.length > 0) {
      throw new UnprocessableEntityException({
        message: `A importação foi cancelada: ${erros.length} linha(s) têm erro. Nenhum registro foi gravado. Corrija a planilha e envie de novo.`,
        erros,
      });
    }

    const criados = await this.gravar(
      ownerId,
      tipo,
      linhas,
      catalogo,
      clientes,
    );

    const importacaoId = randomUUID();
    await this.audit.registrar({
      entity: 'IMPORT',
      entityId: importacaoId, // uuid do lote; AuditLog.entityId não tem FK
      entityLabel: nomeArquivo,
      action: 'IMPORTAR',
      extra: {
        tipo,
        totalDeLinhas: linhas.length,
        criados,
        origensCriadas: criadas.map((c) => c.name),
        origensIgnoradas: ignoradas,
      },
    });
    this.logger.log({
      evento: 'importacao.concluida',
      msg: 'Importação de planilha concluída.',
      tipo,
      importacaoId,
      linhas: linhas.length,
      criados,
      ms: Date.now() - inicio,
    });

    return {
      tipo,
      totalDeLinhas: linhas.length,
      criados,
      origensCriadas: criadas.map((c) => c.name),
      origensIgnoradas: ignoradas,
      erros: [],
    };
  }

  /**
   * Aplica as decisões do usuário sobre as origens desconhecidas ANTES de
   * validar qualquer linha — é o que faz a origem recém-criada/aliada já
   * casar na validação e na gravação seguintes.
   */
  private async aplicarDecisoesDeOrigem(
    ownerId: string,
    origens: DecisaoDeOrigem[],
    catalogo: Awaited<ReturnType<CatalogResolver['carregar']>>,
    podeGerenciarCatalogo: boolean,
  ): Promise<{ criadas: CatalogItem[]; ignoradas: string[] }> {
    const criadas: CatalogItem[] = [];
    const ignoradas: string[] = [];
    for (const decisao of origens) {
      if (decisao.acao === 'criar') {
        if (!podeGerenciarCatalogo) {
          throw new ForbiddenException(
            'Criar uma fonte de lead nova exige a permissão de gerenciar catálogos. Escolha uma fonte existente ou deixe em branco.',
          );
        }
        const item = await this.catalogos.create(ownerId, 'fontes-de-lead', {
          name: decisao.valor.trim(),
        });
        catalogo.registrar(item);
        criadas.push(item);
      } else if (decisao.acao === 'usar') {
        if (!decisao.itemId) {
          throw new BadRequestException(
            'Escolha a fonte de lead existente para usar.',
          );
        }
        const item = await this.catalogos.findOne(
          ownerId,
          'fontes-de-lead',
          decisao.itemId,
        );
        catalogo.registrarAlias(decisao.valor, item);
      } else {
        ignoradas.push(decisao.valor);
      }
    }
    return { criadas, ignoradas };
  }

  /** Grava linha a linha, EM SÉRIE (nunca `Promise.all`) — mantém a ordem e não estoura o pool da transação. */
  private async gravar(
    ownerId: string,
    tipo: TipoDeImportacao,
    linhas: Record<string, string>[],
    catalogo: Awaited<ReturnType<CatalogResolver['carregar']>>,
    clientes: ClientesIndexados | null,
  ): Promise<number> {
    let criados = 0;
    if (tipo === 'clientes') {
      for (const linha of linhas) {
        await this.clients.create(
          ownerId,
          construirDtoDeCliente(linha, catalogo),
        );
        criados++;
      }
      return criados;
    }
    for (const linha of linhas) {
      // `clientes` não é null aqui: `carregarClientesSeNecessario` sempre o
      // popula para `tipo === 'contatos'`, e a validação acima já garantiu
      // que a linha casa com exatamente um cliente.
      const resolvido = resolverCliente(linha, clientes!);
      if (!resolvido || resolvido === 'ambiguo') {
        throw new UnprocessableEntityException(
          'Cliente não encontrado para uma das linhas — reenvie a planilha.',
        );
      }
      await this.contacts.create(
        ownerId,
        resolvido.id,
        construirDtoDeContato(linha),
      );
      criados++;
    }
    return criados;
  }

  private carregarClientesSeNecessario(
    ownerId: string,
    tipo: TipoDeImportacao,
  ): Promise<ClientesIndexados | null> {
    if (tipo !== 'contatos') return Promise.resolve(null);
    return this.clients
      .listImportRefs(ownerId)
      .then((refs) => indexarClientes(refs));
  }
}
