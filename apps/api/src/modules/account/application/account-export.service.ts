import { Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import {
  ACCOUNT_DUMP_REPOSITORY,
  type AccountDumpRepository,
  type DadosDoDump,
} from '../domain/account-dump.repository';
import {
  NAO_INCLUIDO,
  VERSAO_DO_DUMP,
  type AccountDump,
} from '../domain/account-dump';

@Injectable()
export class AccountExportService {
  private readonly logger = new Logger(AccountExportService.name);

  constructor(
    @Inject(ACCOUNT_DUMP_REPOSITORY)
    private readonly repo: AccountDumpRepository,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Monta o dump e devolve o arquivo pronto. `StreamableFile` sobre um Buffer já
   * serializado, pelo mesmo motivo do `ExportService`: quando o interceptor
   * commita a transação do request não há mais trabalho de banco pendente, e o
   * download não segura conexão do pool.
   *
   * Sem teto de linhas, de propósito. `assertCabeNaExportacao` existe para uma
   * listagem filtrável — um 422 "refine os filtros" num pedido de portabilidade,
   * que por definição é "tudo", seria negar o direito com uma mensagem sem
   * sentido. O limite real é a transação de 5s; por isso o `ms` no log.
   */
  async gerar(ownerId: string): Promise<StreamableFile> {
    const inicio = Date.now();
    const dados = await this.repo.carregar(ownerId);
    const dump = this.montar(dados);
    const buffer = Buffer.from(JSON.stringify(dump, null, 2), 'utf8');

    await this.audit.registrar({
      entity: 'ACCOUNT',
      entityId: ownerId,
      entityLabel: 'Meus dados',
      action: 'EXPORTAR',
      extra: {
        versaoDoEsquema: VERSAO_DO_DUMP,
        contagem: dump.manifesto.contagem,
        bytes: buffer.byteLength,
      },
    });
    this.logger.log({
      evento: 'conta.dados_exportados',
      msg: 'Dump de portabilidade gerado.',
      ownerId,
      bytes: buffer.byteLength,
      ms: Date.now() - inicio,
    });

    const dia = new Date().toISOString().slice(0, 10);
    return new StreamableFile(buffer, {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="meus-dados-${dia}.json"`,
      length: buffer.byteLength,
    });
  }

  private montar(dados: DadosDoDump): AccountDump {
    const contagem: Record<string, number> = {
      colaboradores: dados.colaboradores.length,
      papeis: dados.papeis.length,
      funil: dados.funil.length,
      'catalogos.fontesDeLead': dados.catalogos.fontesDeLead.length,
      'catalogos.tiposDeServico': dados.catalogos.tiposDeServico.length,
      'catalogos.tiposDeAtividade': dados.catalogos.tiposDeAtividade.length,
      'catalogos.motivosDePerda': dados.catalogos.motivosDePerda.length,
      canaisDeCaptacao: dados.canaisDeCaptacao.length,
      clientes: dados.clientes.length,
      contatos: dados.contatos.length,
      oportunidades: dados.oportunidades.length,
      propostas: dados.propostas.length,
      projetos: dados.projetos.length,
      demandas: dados.demandas.length,
      contratos: dados.contratos.length,
      cobrancas: dados.cobrancas.length,
      atividades: dados.atividades.length,
    };

    return {
      manifesto: {
        versaoDoEsquema: VERSAO_DO_DUMP,
        geradoEm: new Date().toISOString(),
        origem: this.origem(),
        contagem,
        naoIncluido: NAO_INCLUIDO,
      },
      conta: dados.conta,
      assinatura: dados.assinatura,
      colaboradores: dados.colaboradores,
      papeis: dados.papeis,
      funil: dados.funil,
      catalogos: dados.catalogos,
      canaisDeCaptacao: dados.canaisDeCaptacao,
      clientes: dados.clientes,
      contatos: dados.contatos,
      oportunidades: dados.oportunidades,
      propostas: dados.propostas,
      projetos: dados.projetos,
      demandas: dados.demandas,
      contratos: dados.contratos,
      cobrancas: dados.cobrancas,
      atividades: dados.atividades,
    };
  }

  /** Domínio da instância, para o titular saber a origem do arquivo. */
  private origem(): string {
    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    try {
      return new URL(base).host || base;
    } catch {
      return base;
    }
  }
}
