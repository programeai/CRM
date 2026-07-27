import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PaymentStatus } from '@prisma/client';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type PaymentWithContract,
} from '../domain/payment.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { AuditService } from '../../audit/audit.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { ListPaymentsQueryDto } from '../api/dto/list-payments-query.dto';
import type { PaymentSummaryQueryDto } from '../api/dto/payment-summary-query.dto';
import type { UpdatePaymentDto } from '../api/dto/update-payment.dto';
import type { PayPaymentDto } from '../api/dto/pay-payment.dto';

const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'CANCELED'],
  OVERDUE: ['PAID', 'CANCELED'],
  PAID: ['PENDING'], // estorno
  CANCELED: [],
};

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string, query: ListPaymentsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      clientId: query.clientId,
      contractId: query.contractId,
      status: query.status,
      billingType: query.billingType,
      dueFrom: query.dueFrom ? new Date(query.dueFrom) : undefined,
      dueTo: query.dueTo ? new Date(query.dueTo) : undefined,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  /**
   * Totais para os cards de recebimentos, respeitando os filtros (exceto status):
   * `recebido` (PAID), `aReceber` (PENDING + OVERDUE) e `emAtraso` (OVERDUE).
   */
  async summary(ownerId: string, query: PaymentSummaryQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const rows = await this.repo.sumByStatus({
      ownerId,
      search: query.search,
      clientId: query.clientId,
      contractId: query.contractId,
      billingType: query.billingType,
      dueFrom: query.dueFrom ? new Date(query.dueFrom) : undefined,
      dueTo: query.dueTo ? new Date(query.dueTo) : undefined,
    });
    const find = (s: PaymentStatus) => rows.find((r) => r.status === s);
    const paid = find('PAID');
    const pending = find('PENDING');
    const overdue = find('OVERDUE');
    const recebido = paid ? paid.paidAmount || paid.amount : 0;
    const emAtraso = overdue?.amount ?? 0;
    const aReceber = (pending?.amount ?? 0) + emAtraso;
    return { recebido, aReceber, emAtraso };
  }

  /** Editar cobrança APENAS enquanto PENDING (valor/vencimento/descrição). */
  async update(
    ownerId: string,
    id: string,
    dto: UpdatePaymentDto,
  ): Promise<PaymentWithContract> {
    const p = await this.loadOwned(ownerId, id);
    if (p.status !== 'PENDING') {
      throw new UnprocessableEntityException(
        'Apenas cobranças pendentes podem ser editadas.',
      );
    }
    const atualizado = await this.repo.update(id, {
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
    });
    await this.audit.registrar({
      entity: 'PAYMENT',
      entityId: id,
      entityLabel: p.description,
      action: 'ATUALIZAR',
      antes: p,
      depois: atualizado,
    });
    return atualizado;
  }

  /** Baixa: PENDING|OVERDUE → PAID. */
  async pay(
    ownerId: string,
    id: string,
    dto: PayPaymentDto,
  ): Promise<PaymentWithContract> {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'PAID');
    const atualizado = await this.repo.update(id, {
      status: 'PAID',
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      paidAmount: dto.paidAmount ?? p.amount, // aceita valor parcial/diferente
      method: dto.method,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
    await this.audit.registrar({
      entity: 'PAYMENT',
      entityId: id,
      entityLabel: p.description,
      action: 'PAGAR',
      antes: p,
      depois: atualizado,
    });
    return atualizado;
  }

  /** Estorno: PAID → PENDING; nunca exclui; registra em notes. */
  async revert(ownerId: string, id: string): Promise<PaymentWithContract> {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'PENDING');
    const stamp = `Estorno em ${new Date().toISOString().slice(0, 10)}`;
    const atualizado = await this.repo.update(id, {
      status: 'PENDING',
      paidAt: null,
      paidAmount: null,
      method: null,
      notes: p.notes ? `${p.notes}\n${stamp}` : stamp,
    });
    await this.audit.registrar({
      entity: 'PAYMENT',
      entityId: id,
      entityLabel: p.description,
      action: 'ESTORNAR',
      antes: p,
      depois: atualizado,
    });
    return atualizado;
  }

  /** Cancelar: PENDING|OVERDUE → CANCELED. */
  async cancel(ownerId: string, id: string): Promise<PaymentWithContract> {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'CANCELED');
    const atualizado = await this.repo.update(id, { status: 'CANCELED' });
    await this.audit.registrar({
      entity: 'PAYMENT',
      entityId: id,
      entityLabel: p.description,
      action: 'CANCELAR',
      antes: p,
      depois: atualizado,
    });
    return atualizado;
  }

  /** Carrega a cobrança garantindo que o cliente (via contrato) pertence ao usuário. */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<PaymentWithContract> {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundException('Cobrança não encontrada.');
    await this.clients.findOne(ownerId, p.contract.clientId); // 404 se não for do dono
    return p;
  }

  private assertTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new UnprocessableEntityException('Transição de status inválida.');
    }
  }
}
