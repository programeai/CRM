/**
 * Versão do esquema do dump. Sobe quando uma coleção é adicionada, removida ou
 * troca de forma — é o que permite a quem recebeu um arquivo antigo saber o que
 * esperar dele. Vai no manifest, por exigência prática de portabilidade (WP29:
 * "along with useful metadata").
 */
export const VERSAO_DO_DUMP = 1;

/**
 * O que o dump NÃO carrega, declarado no próprio arquivo. Metade por segurança
 * (segredo não sai daqui nem para o titular: o hash de senha e o hash de chave de
 * integração não têm utilidade subsequente e vazam se o arquivo vazar), metade
 * por escopo (trilha e notificações ficaram para depois).
 */
export const NAO_INCLUIDO = [
  'Hash da senha e hashes de token (redefinição, convite, sessão).',
  'Hash e valor de chaves de integração — apenas o prefixo visível é incluído.',
  'Configuração dos destinos de notificação (a URL de um webhook É a credencial).',
  'Identificadores do cliente e da assinatura na Stripe.',
  'Trilha de auditoria e histórico de notificações.',
] as const;

export interface ManifestoDoDump {
  versaoDoEsquema: number;
  geradoEm: string;
  /** Domínio da instância que gerou o arquivo, para o titular saber a origem. */
  origem: string;
  /** Quantas linhas por coleção — confere o arquivo sem abri-lo inteiro. */
  contagem: Record<string, number>;
  naoIncluido: readonly string[];
}

export interface ContaExportada {
  id: string;
  nome: string;
  email: string;
  criadaEm: Date;
  /** `false` na conta criada só por login social — não há senha a reconfirmar. */
  temSenha: boolean;
  loginSocial: { provedor: string; vinculadoEm: Date }[];
}

export interface AssinaturaExportada {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
}

export interface ColaboradorExportado {
  nome: string;
  email: string;
  ativo: boolean;
  papel: string | null;
  conviteAceitoEm: Date | null;
  criadoEm: Date;
}

export interface PapelExportado {
  name: string;
  description: string | null;
  system: boolean;
  permissions: string[];
  createdAt: Date;
}

export interface EstagioExportado {
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}

export interface CatalogoItemExportado {
  name: string;
  active: boolean;
}

export interface TipoDeAtividadeExportado extends CatalogoItemExportado {
  isFollowUp: boolean;
}

export interface CatalogosExportados {
  fontesDeLead: CatalogoItemExportado[];
  tiposDeServico: CatalogoItemExportado[];
  tiposDeAtividade: TipoDeAtividadeExportado[];
  motivosDePerda: CatalogoItemExportado[];
}

export interface CanalExportado {
  name: string;
  fonte: string | null;
  responsavel: string | null;
  prefixoDaChave: string | null;
  createdAt: Date;
}

export interface ClienteExportado {
  id: string;
  name: string;
  tradeName: string | null;
  personType: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  origem: string | null;
  responsavel: string | null;
  tags: string[];
  notes: string | null;
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface ContatoExportado {
  cliente: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  archivedAt: Date | null;
}

export interface OportunidadeExportada {
  id: string;
  cliente: string;
  estagio: string;
  tipoDeServico: string;
  title: string;
  amount: string | null;
  probability: number | null;
  expectedClose: Date | null;
  motivoDePerda: string | null;
  responsavel: string | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface ItemDePropostaExportado {
  description: string;
  quantity: string;
  unitPrice: string;
  order: number;
}

export interface PropostaExportada {
  number: string;
  version: number;
  /** Número da versão anterior — tradução de `parentId` (nunca o id cru). */
  versaoDe: string | null;
  cliente: string;
  tipoDeServico: string;
  status: string;
  scope: string | null;
  paymentTerms: string | null;
  deliveryTime: string | null;
  validUntil: Date | null;
  discount: string | null;
  total: string;
  itens: ItemDePropostaExportado[];
  sentAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ProjetoExportado {
  cliente: string;
  tipoDeServico: string;
  name: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface DemandaExportada {
  projeto: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | null;
  tags: string[];
  responsavel: string | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface ContratoExportado {
  cliente: string;
  projeto: string | null;
  proposta: string | null;
  description: string;
  billingType: string;
  status: string;
  monthlyAmount: string | null;
  billingDay: number | null;
  startDate: Date | null;
  endDate: Date | null;
  downPayment: string | null;
  installments: number | null;
  installmentAmount: string | null;
  createdAt: Date;
}

export interface CobrancaExportada {
  contrato: string;
  description: string;
  amount: string;
  dueDate: Date;
  status: string;
  paidAt: Date | null;
  paidAmount: string | null;
  method: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface AtividadeExportada {
  cliente: string;
  tipo: string;
  content: string;
  responsavel: string | null;
  scheduledFor: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface AccountDump {
  manifesto: ManifestoDoDump;
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
}
