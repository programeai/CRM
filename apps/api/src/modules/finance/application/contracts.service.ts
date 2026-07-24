import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ContractStatus } from '@prisma/client';
import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  type ContractWithPayments,
} from '../domain/contract.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import { buildInstallmentSchedule, buildOneTimeSchedule } from './schedule';
import type { CreateContractDto } from '../api/dto/create-contract.dto';
import type { UpdateContractDto } from '../api/dto/update-contract.dto';
import type { ListContractsQueryDto } from '../api/dto/list-contracts-query.dto';

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
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
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
  }

  async pause(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'PAUSED');
    return this.repo.update(id, { status: 'PAUSED' });
  }

  async resume(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'ACTIVE');
    return this.repo.update(id, { status: 'ACTIVE' });
  }

  /** Cancela o contrato e as cobranças em aberto (PENDING/OVERDUE); as PAID ficam no histórico. */
  async cancel(ownerId: string, id: string): Promise<ContractWithPayments> {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'CANCELED');
    return this.repo.update(id, {
      status: 'CANCELED',
      payments: {
        updateMany: {
          where: { status: { in: ['PENDING', 'OVERDUE'] } },
          data: { status: 'CANCELED' },
        },
      },
    });
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
