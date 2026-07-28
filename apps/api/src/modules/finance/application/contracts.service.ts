import {
  Inject,
  Injectable,
  NotFoundException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ContractStatus } from '@prisma/client';
import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  type ContractWithPayments,
} from '../domain/contract.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { AuditService } from '../../audit/audit.service';
import { ExportService } from '../../data/application/export.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import {
  assertCabeNaExportacao,
  MAX_EXPORT_ROWS,
} from '../../../shared/export';
import { buildInstallmentSchedule, buildOneTimeSchedule } from './schedule';
import { COLUNAS_DE_CONTRATO } from './contract-export-columns';
import type { CreateContractDto } from '../api/dto/create-contract.dto';
import type { UpdateContractDto } from '../api/dto/update-contract.dto';
import type { ListContractsQueryDto } from '../api/dto/list-contracts-query.dto';
import type { ExportContractsQueryDto } from '../api/dto/export-contracts-query.dto';

// Transições manuais permitidas (FINISHED reservado para o futuro — sem ação `finish`).
const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  ACTIVE: ['PAUSED', 'CANCELED'],
  PAUSED: ['ACTIVE', 'CANCELED'],
  FINISHED: [],
  CANCELED: [],
};

@Injectable()
export class ContractsService {
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly repo: ContractRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly exporter: ExportService,
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
    // projectId/proposalId são opcionais e de baixo risco: sem validação cruzada
    // nesta fase para não acoplar o FinanceModule a ProjectsModule/ProposalsModule
    // (ver "Dependencies & Risks" do spec).

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
