import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ContractStatus } from '@prisma/client';
import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  type ContractWithPayments,
} from '../domain/contract.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { AuditService } from '../../audit/audit.service';
import { ExportService } from '../../data/application/export.service';
import { ProposalsService } from '../../proposals/application/proposals.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import {
  assertCabeNaExportacao,
  MAX_EXPORT_ROWS,
} from '../../../shared/export';
import { buildInstallmentSchedule, buildOneTimeSchedule } from './schedule';
import { COLUNAS_DE_CONTRATO } from './contract-export-columns';
import { derivarContrato, type ContratoDerivado } from './proposal-plan';
import type { PreviaDeContrato } from './contract-preview';
import {
  assertPlanoCoerente,
  planoDaLinha,
  planoDoDto,
  type BillingPlan,
  type BillingPlanRow,
} from '../../../shared/billing-plan';
import type { CreateContractDto } from '../api/dto/create-contract.dto';
import type { UpdateContractDto } from '../api/dto/update-contract.dto';
import type { ListContractsQueryDto } from '../api/dto/list-contracts-query.dto';
import type { ExportContractsQueryDto } from '../api/dto/export-contracts-query.dto';
import type { DeriveContractFromProposalDto } from '../api/dto/derive-contract-from-proposal.dto';

// Transições manuais permitidas (FINISHED reservado para o futuro — sem ação `finish`).
const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  ACTIVE: ['PAUSED', 'CANCELED'],
  PAUSED: ['ACTIVE', 'CANCELED'],
  FINISHED: [],
  CANCELED: [],
};

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly repo: ContractRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
    private readonly proposals: ProposalsService,
  ) {}

  async list(ownerId: string, query: ListContractsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      status: query.status,
      billingType: query.billingType,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  /**
   * Exportação da listagem. `Contract` não tem `assigneeId` (recorte por
   * responsável não se aplica) — o filtro é `ownerId` puro, igual ao de `list`.
   */
  async export(
    ownerId: string,
    query: ExportContractsQueryDto,
  ): Promise<StreamableFile> {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      status: query.status,
      billingType: query.billingType,
      skip: 0,
      take: MAX_EXPORT_ROWS,
    });
    assertCabeNaExportacao(total);
    return this.exporter.gerar(
      data,
      COLUNAS_DE_CONTRATO,
      query.formato,
      'contratos',
    );
  }

  async listByClient(
    ownerId: string,
    clientId: string,
  ): Promise<ContractWithPayments[]> {
    await this.clients.findOne(ownerId, clientId); // posse
    return this.repo.findByClient(clientId);
  }

  async findOne(ownerId: string, id: string): Promise<ContractWithPayments> {
    return this.loadOwned(ownerId, id);
  }

  async create(
    ownerId: string,
    dto: CreateContractDto,
  ): Promise<ContractWithPayments> {
    await this.clients.findOne(ownerId, dto.clientId); // valida posse do cliente
    // `proposalId` informado aqui NÃO é validado: este é o caminho manual, e a
    // geração a partir de proposta tem rota própria (`createFromProposal`), que
    // valida posse, status e cadeia. `projectId` segue sem validação cruzada —
    // o FinanceModule não importa ProjectsModule.

    const base = {
      ownerId,
      clientId: dto.clientId,
      projectId: dto.projectId ?? null,
      proposalId: dto.proposalId ?? null,
      description: dto.description,
      billingType: dto.billingType,
      status: 'ACTIVE' as const,
    };

    const criado = await this.createByBillingType(ownerId, dto, base);
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: criado.id,
      entityLabel: criado.description,
      action: 'CRIAR',
      extra: { cobrancasGeradas: criado.payments.length },
    });
    return criado;
  }

  /** Cada tipo de cobrança monta o seu cronograma; o registro sai igual nos três. */
  private createByBillingType(
    ownerId: string,
    dto: CreateContractDto,
    base: {
      ownerId: string;
      clientId: string;
      projectId: string | null;
      proposalId: string | null;
      description: string;
      billingType: CreateContractDto['billingType'];
      status: 'ACTIVE';
    },
  ): Promise<ContractWithPayments> {
    if (dto.billingType === 'INSTALLMENTS') {
      const charges = buildInstallmentSchedule({
        downPayment: dto.downPayment,
        downPaymentDueDate: dto.downPaymentDueDate
          ? new Date(dto.downPaymentDueDate)
          : null,
        installments: dto.installments!,
        installmentAmount: dto.installmentAmount!,
        firstInstallmentDueDate: new Date(dto.firstInstallmentDueDate!),
      });
      return this.repo.create({
        ...base,
        downPayment: dto.downPayment ?? null,
        installments: dto.installments!,
        installmentAmount: dto.installmentAmount!,
        payments: {
          create: charges.map((c) => ({
            ownerId,
            description: c.description,
            amount: c.amount,
            dueDate: c.dueDate,
          })),
        },
      });
    }

    if (dto.billingType === 'ONE_TIME') {
      const charges = buildOneTimeSchedule(dto.amount!, new Date(dto.dueDate!));
      return this.repo.create({
        ...base,
        payments: {
          create: charges.map((c) => ({
            ownerId,
            description: c.description,
            amount: c.amount,
            dueDate: c.dueDate,
          })),
        },
      });
    }

    // RECURRING — nenhuma cobrança na criação (o cron gera as mensalidades)
    return this.repo.create({
      ...base,
      monthlyAmount: dto.monthlyAmount!,
      billingDay: dto.billingDay!,
      startDate: new Date(dto.startDate!),
      endDate: dto.endDate ? new Date(dto.endDate) : null,
    });
  }

  /**
   * Deriva o contrato de uma proposta sem gravar nada — é a tela de
   * conferência. Cada ajuste no plano refaz esta chamada, então a matemática de
   * dinheiro (rateio, sobra de centavos) vive só aqui e nunca no frontend.
   *
   * É POST porque recebe corpo (o plano em edição), não porque escreve: nada
   * nesta rota toca o banco além das leituras de posse.
   */
  async previewFromProposal(
    ownerId: string,
    proposalId: string,
    dto: DeriveContractFromProposalDto,
  ): Promise<PreviaDeContrato> {
    const proposta = await this.proposals.findOne(ownerId, proposalId); // 404 se não for do dono
    const plano = this.planoParaDerivacao(proposta, dto);
    // A prévia não recusa ESTADO — status da proposta, ausência de plano e
    // contrato já existente ela apenas RELATA, e a tela decide o que habilitar.
    // Mas plano INCOERENTE ela recusa, com o mesmo 422 da rota que grava: sem
    // isso a derivação ignora em silêncio o campo que não pertence ao regime
    // (um `installments` num plano RECURRING, por exemplo) e devolve uma agenda
    // plausível que não corresponde ao que a pessoa digitou. A tela mostra esta
    // mensagem no lugar da agenda — é o erro inline da tela de conferência.
    if (plano) assertPlanoCoerente(plano);
    const existentes = await this.contratosDaCadeia(ownerId, proposalId);
    return {
      proposta: {
        id: proposta.id,
        number: proposta.number,
        version: proposta.version,
        status: proposta.status,
        total: proposta.total,
        decidedAt: proposta.decidedAt,
        clientId: proposta.clientId,
        client: proposta.client,
      },
      plano,
      derivado:
        plano && proposta.decidedAt
          ? derivarContrato({
              plano,
              total: Number(proposta.total),
              ancora: proposta.decidedAt,
            })
          : null,
      descricaoSugerida: dto.description ?? `Contrato — ${proposta.number}`,
      contratosExistentes: existentes.map((c) => ({
        id: c.id,
        description: c.description,
        status: c.status,
        proposalId: c.proposalId,
      })),
    };
  }

  /**
   * Gera o contrato a partir de uma proposta aceita, com a agenda derivada do
   * plano. Um clique = um contrato + N cobranças + um registro de auditoria.
   */
  async createFromProposal(
    ownerId: string,
    proposalId: string,
    dto: DeriveContractFromProposalDto,
  ): Promise<ContractWithPayments> {
    const proposta = await this.proposals.findOne(ownerId, proposalId); // 404 se não for do dono
    if (proposta.status !== 'ACCEPTED') {
      throw new UnprocessableEntityException(
        'Só proposta aceita gera contrato.',
      );
    }
    if (!proposta.decidedAt) {
      // Defensivo: `accept` grava `decidedAt` junto do status, e ACCEPTED é
      // terminal. Sem âncora não há como converter offset em data.
      throw new UnprocessableEntityException(
        'A proposta não tem data de aceite — não há âncora para os prazos.',
      );
    }
    const plano = this.planoParaDerivacao(proposta, dto);
    if (!plano) {
      throw new UnprocessableEntityException(
        'Esta proposta não tem plano de cobrança. Preencha o plano na tela de geração.',
      );
    }
    assertPlanoCoerente(plano);

    // Um contrato por CADEIA de versões, não por linha: o @unique cobre a
    // linha, mas duas versões da mesma proposta são linhas distintas.
    const existentes = await this.contratosDaCadeia(ownerId, proposalId);
    if (existentes.length > 0) {
      const [c] = existentes;
      throw new ConflictException(
        `A proposta ${proposta.number} já gerou o contrato “${c.description}”. Cancele-o antes de gerar outro.`,
      );
    }

    const derivado = derivarContrato({
      plano,
      total: Number(proposta.total),
      ancora: proposta.decidedAt,
    });
    if (
      derivado.billingType === 'INSTALLMENTS' &&
      derivado.installmentAmount === 0
    ) {
      // Entrada cobrindo o total geraria N cobranças de R$ 0,00.
      throw new UnprocessableEntityException(
        'A entrada cobre o total da proposta: não sobra valor para parcelar.',
      );
    }

    const criado = await this.gravarDerivado(ownerId, proposta, dto, derivado);
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: criado.id,
      entityLabel: criado.description,
      action: 'CRIAR',
      // Um registro só: as N cobranças são consequência de uma intenção
      // (molde de `cancel`). `AuditAction` não tem "GERAR" — CRIAR com a
      // origem no `extra` cabe sem migration de enum.
      extra: {
        cobrancasGeradas: criado.payments.length,
        derivadoDeProposta: true,
        propostaId: proposta.id,
        propostaNumero: proposta.number,
        propostaVersao: proposta.version,
      },
    });
    this.logger.log({
      evento: 'contrato.derivado_de_proposta',
      msg: 'Contrato gerado a partir do plano de cobrança da proposta.',
      contratoId: criado.id,
      propostaId: proposta.id,
      regime: derivado.billingType,
      cobrancas: criado.payments.length,
    });
    return criado;
  }

  /** Contratos gerados por qualquer versão da cadeia da proposta informada. */
  async listByProposal(
    ownerId: string,
    proposalId: string,
  ): Promise<ContractWithPayments[]> {
    await this.proposals.findOne(ownerId, proposalId); // posse (404)
    return this.contratosDaCadeia(ownerId, proposalId);
  }

  /**
   * Plano do body (tela de conferência) ou o gravado na proposta; null quando
   * não há nenhum (proposta do histórico).
   *
   * `planoDoDto` devolve `undefined` quando `billingType` não veio — no body
   * isso significa "use o que está gravado".
   */
  private planoParaDerivacao(
    proposta: BillingPlanRow,
    dto: DeriveContractFromProposalDto,
  ): BillingPlan | null {
    return planoDoDto(dto.plano ?? {}) ?? planoDaLinha(proposta);
  }

  private async contratosDaCadeia(ownerId: string, proposalId: string) {
    const cadeia = await this.proposals.versions(ownerId, proposalId);
    return this.repo.findByProposalIds(cadeia.map((p) => p.id));
  }

  /**
   * Grava contrato + cobranças. O `@unique` em `proposalId` é a última linha de
   * defesa da idempotência: dois cliques simultâneos passam os dois pela
   * checagem de cadeia (nenhum contrato existia quando cada um consultou) e é o
   * banco que derruba o segundo. P2002 traduzido para a mesma mensagem do 409.
   */
  private async gravarDerivado(
    ownerId: string,
    proposta: { id: string; clientId: string; number: string },
    dto: DeriveContractFromProposalDto,
    derivado: ContratoDerivado,
  ): Promise<ContractWithPayments> {
    try {
      return await this.repo.create({
        ownerId,
        clientId: proposta.clientId,
        projectId: dto.projectId ?? null,
        proposalId: proposta.id,
        description: dto.description ?? `Contrato — ${proposta.number}`,
        billingType: derivado.billingType,
        status: 'ACTIVE',
        monthlyAmount: derivado.monthlyAmount,
        billingDay: derivado.billingDay,
        startDate: derivado.startDate,
        endDate: derivado.endDate,
        downPayment: derivado.downPayment,
        installments: derivado.installments,
        installmentAmount: derivado.installmentAmount,
        payments: {
          create: derivado.cobrancas.map((c) => ({
            ownerId,
            description: c.description,
            amount: c.amount,
            dueDate: c.dueDate,
          })),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A proposta ${proposta.number} já gerou um contrato.`,
        );
      }
      throw e;
    }
  }

  /** Reajuste: editar monthlyAmount vale só para cobranças FUTURAS (as já geradas não mudam). */
  async update(
    ownerId: string,
    id: string,
    dto: UpdateContractDto,
  ): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    const atualizado = await this.repo.update(id, {
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.monthlyAmount !== undefined
        ? { monthlyAmount: dto.monthlyAmount }
        : {}),
      ...(dto.billingDay !== undefined ? { billingDay: dto.billingDay } : {}),
      ...(dto.endDate !== undefined
        ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
        : {}),
    });
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: id,
      entityLabel: c.description,
      action: 'ATUALIZAR',
      antes: c,
      depois: atualizado,
    });
    return atualizado;
  }

  async pause(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'PAUSED');
    const atualizado = await this.repo.update(id, { status: 'PAUSED' });
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: id,
      entityLabel: c.description,
      action: 'PAUSAR',
      antes: c,
      depois: atualizado,
    });
    return atualizado;
  }

  async resume(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'ACTIVE');
    const atualizado = await this.repo.update(id, { status: 'ACTIVE' });
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: id,
      entityLabel: c.description,
      action: 'RETOMAR',
      antes: c,
      depois: atualizado,
    });
    return atualizado;
  }

  /** Cancela o contrato e as cobranças em aberto (PENDING/OVERDUE); as PAID ficam no histórico. */
  async cancel(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'CANCELED');
    const emAberto = c.payments.filter(
      (p) => p.status === 'PENDING' || p.status === 'OVERDUE',
    ).length;
    const cancelado = await this.repo.update(id, {
      status: 'CANCELED',
      payments: {
        updateMany: {
          where: { status: { in: ['PENDING', 'OVERDUE'] } },
          data: { status: 'CANCELED' },
        },
      },
    });
    // Um registro agregado, não N: a pergunta é "quem cancelou o contrato e
    // quantas cobranças caíram junto", e N linhas de Payment com o mesmo autor
    // e o mesmo instante seriam ruído na tela de auditoria.
    await this.audit.registrar({
      entity: 'CONTRACT',
      entityId: id,
      entityLabel: c.description,
      action: 'CANCELAR',
      antes: c,
      depois: cancelado,
      extra: { cobrancasCanceladas: emAberto },
    });
    return cancelado;
  }

  /** Carrega o contrato garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<ContractWithPayments> {
    const contract = await this.repo.findById(id);
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    await this.clients.findOne(ownerId, contract.clientId); // 404 se não for do dono
    return contract;
  }

  private assertTransition(from: ContractStatus, to: ContractStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new UnprocessableEntityException('Transição de status inválida.');
    }
  }
}
