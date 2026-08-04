import type {
  AssinaturaExportada,
  AtividadeExportada,
  ConsentimentoExportado,
  CanalExportado,
  CatalogosExportados,
  ClienteExportado,
  CobrancaExportada,
  ColaboradorExportado,
  ContaExportada,
  ContatoExportado,
  ContratoExportado,
  DemandaExportada,
  EstagioExportado,
  OportunidadeExportada,
  PapelExportado,
  ProjetoExportado,
  PropostaExportada,
} from './account-dump';

export const ACCOUNT_DUMP_REPOSITORY = 'ACCOUNT_DUMP_REPOSITORY';

/** Coleções cruas da workspace, na forma em que vão para o JSON. */
export interface DadosDoDump {
  conta: ContaExportada;
  assinatura: AssinaturaExportada | null;
  colaboradores: ColaboradorExportado[];
  papeis: PapelExportado[];
  funil: EstagioExportado[];
  catalogos: CatalogosExportados;
  canaisDeCaptacao: CanalExportado[];
  clientes: ClienteExportado[];
  contatos: ContatoExportado[];
  oportunidades: OportunidadeExportada[];
  propostas: PropostaExportada[];
  projetos: ProjetoExportado[];
  demandas: DemandaExportada[];
  contratos: ContratoExportado[];
  cobrancas: CobrancaExportada[];
  atividades: AtividadeExportada[];
  consentimentos: ConsentimentoExportado[];
}

export interface AccountDumpRepository {
  /**
   * Carrega a workspace inteira. Roda DENTRO da transação do request, sob o
   * `app.owner_id` do interceptor: as 11 tabelas de negócio já vêm isoladas pelo
   * RLS. `User` está FORA do RLS, então as leituras de `User` filtram por
   * `ownerId`/`id` explicitamente — é a única parte deste repositório onde o
   * isolamento é responsabilidade do código.
   */
  carregar(ownerId: string): Promise<DadosDoDump>;
}
