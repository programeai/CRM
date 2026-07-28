import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ProposalStatus } from '@prisma/client';
import {
  PROPOSAL_REPOSITORY,
  type ProposalRepository,
  type ProposalWithItems,
} from '../domain/proposal.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { DealsService } from '../../pipeline/application/deals.service';
import { PipelineStagesService } from '../../pipeline/application/pipeline-stages.service';
import { AuditService } from '../../audit/audit.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import { computeTotal } from './money';
import type { CreateProposalDto } from '../api/dto/create-proposal.dto';
import type { UpdateProposalDto } from '../api/dto/update-proposal.dto';
import type { ListProposalsQueryDto } from '../api/dto/list-proposals-query.dto';
import { CatalogosService } from '../../catalogos/application/catalogos.service';

// Transições manuais permitidas (EXPIRED só via cron; ACCEPTED/REJECTED/EXPIRED terminais).
const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['SENT'],
  SENT: ['NEGOTIATING', 'ACCEPTED', 'REJECTED'],
  NEGOTIATING: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

@Injectable()
export class ProposalsService {
  constructor(
    @Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository,
    private readonly clients: ClientsService,
    private readonly deals: DealsService,
    private readonly stages: PipelineStagesService,
    private readonly audit: AuditService,
    private readonly catalogos: CatalogosService,
  ) {}

  async list(ownerId: string, query: ListProposalsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      clientId: query.clientId,
      dealId: query.dealId,
      status: query.status,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async findOne(ownerId: string, id: string): Promise<ProposalWithItems> {
    return this.loadOwned(ownerId, id);
  }

  /** Versões da cadeia (mesmo `number`) da proposta informada. */
  async versions(ownerId: string, id: string): Promise<ProposalWithItems[]> {
    const proposal = await this.loadOwned(ownerId, id);
    return this.repo.findVersionsByNumber(proposal.number);
  }

  async create(
    ownerId: string,
    dto: CreateProposalDto,
  ): Promise<ProposalWithItems> {
    await this.clients.findOne(ownerId, dto.clientId); // valida posse do cliente
    if (dto.dealId) await this.deals.findOne(ownerId, dto.dealId); // valida posse do deal
    await this.catalogos.assertUtilizavel(
      ownerId,
      'servicos',
      dto.serviceTypeId,
    );

    const number = await this.generateNumber();
    const total = computeTotal(dto.items, dto.discount);

    return this.repo.create({
      ownerId,
      number,
      version: 1,
      clientId: dto.clientId,
      dealId: dto.dealId ?? null,
      serviceTypeId: dto.serviceTypeId,
      status: 'DRAFT',
      scope: dto.scope ?? null,
      paymentTerms: dto.paymentTerms ?? null,
      deliveryTime: dto.deliveryTime ?? null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      discount: dto.discount ?? null,
      total,
      items: {
        create: dto.items.map((it, order) => ({
          ownerId,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          order,
        })),
      },
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateProposalDto,
  ): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    if (proposal.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        'Apenas rascunhos podem ser editados. Crie uma nova versão.',
      );
    }
    // Itens e total só recalculados se `items` vier no payload; senão, mantém.
    if (dto.items) {
      const total = computeTotal(dto.items, dto.discount);
      return this.repo.updateWithItems(
        id,
        {
          ...(dto.serviceTypeId !== undefined
            ? { serviceTypeId: dto.serviceTypeId }
            : {}),
          ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
          ...(dto.paymentTerms !== undefined
            ? { paymentTerms: dto.paymentTerms }
            : {}),
          ...(dto.deliveryTime !== undefined
            ? { deliveryTime: dto.deliveryTime }
            : {}),
          ...(dto.validUntil !== undefined
            ? { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }
            : {}),
          discount: dto.discount ?? null,
          total,
        },
        dto.items.map((it, order) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          order,
        })),
      );
    }
    return this.repo.update(id, {
      ...(dto.serviceTypeId !== undefined
        ? { serviceTypeId: dto.serviceTypeId }
        : {}),
      ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
      ...(dto.paymentTerms !== undefined
        ? { paymentTerms: dto.paymentTerms }
        : {}),
      ...(dto.deliveryTime !== undefined
        ? { deliveryTime: dto.deliveryTime }
        : {}),
      ...(dto.validUntil !== undefined
        ? { validUntil: dto.validUntil ? new Date(dto.validUntil) : null }
        : {}),
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const proposal = await this.loadOwned(ownerId, id);
    if (proposal.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        'Apenas rascunhos podem ser excluídos.',
      );
    }
    await this.repo.delete(id);
    await this.audit.registrar({
      entity: 'PROPOSAL',
      entityId: id,
      entityLabel: proposal.number,
      action: 'EXCLUIR',
    });
  }

  async send(ownerId: string, id: string): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    this.assertTransition(proposal.status, 'SENT');
    const enviada = await this.repo.update(id, {
      status: 'SENT',
      sentAt: new Date(),
    });
    await this.audit.registrar({
      entity: 'PROPOSAL',
      entityId: id,
      entityLabel: proposal.number,
      action: 'ENVIAR',
      antes: proposal,
      depois: enviada,
    });
    return enviada;
  }

  async reject(ownerId: string, id: string): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    this.assertTransition(proposal.status, 'REJECTED');
    const recusada = await this.repo.update(id, {
      status: 'REJECTED',
      decidedAt: new Date(),
    });
    await this.audit.registrar({
      entity: 'PROPOSAL',
      entityId: id,
      entityLabel: proposal.number,
      action: 'RECUSAR',
      antes: proposal,
      depois: recusada,
    });
    return recusada;
  }

  async accept(ownerId: string, id: string): Promise<ProposalWithItems> {
    const proposal = await this.loadOwned(ownerId, id);
    this.assertTransition(proposal.status, 'ACCEPTED');
    const accepted = await this.repo.update(id, {
      status: 'ACCEPTED',
      decidedAt: new Date(),
    });
    // Move o deal vinculado para o estágio "Ganhou" (isWon), se houver.
    if (proposal.dealId) await this.moveDealToWon(ownerId, proposal.dealId);
    // Um registro só: o movimento do deal é consequência do aceite, não uma
    // ação independente do usuário.
    await this.audit.registrar({
      entity: 'PROPOSAL',
      entityId: id,
      entityLabel: proposal.number,
      action: 'ACEITAR',
      antes: proposal,
      depois: accepted,
      extra: { dealMovidoParaGanhou: proposal.dealId !== null },
    });
    return accepted;
  }

  /** Clona a proposta como nova versão (mesmo `number`, `version+1`, DRAFT), copiando itens/campos. */
  async newVersion(ownerId: string, id: string): Promise<ProposalWithItems> {
    const source = await this.loadOwned(ownerId, id);
    // Cópia de FK entre registros: o tipo de serviço copiado tem de pertencer ao
    // owner de destino. `findOne` (não `assertUtilizavel`): versionar uma
    // proposta cujo tipo foi DESATIVADO tem de continuar funcionando — é
    // histórico sendo clonado, não escolha nova.
    await this.catalogos.findOne(ownerId, 'servicos', source.serviceTypeId);
    const nova = await this.repo.create({
      ownerId,
      number: source.number,
      version: source.version + 1,
      parentId: source.id,
      clientId: source.clientId,
      dealId: source.dealId,
      serviceTypeId: source.serviceTypeId,
      status: 'DRAFT',
      scope: source.scope,
      paymentTerms: source.paymentTerms,
      deliveryTime: source.deliveryTime,
      validUntil: source.validUntil,
      discount: source.discount,
      total: source.total,
      items: {
        create: source.items.map((it) => ({
          ownerId,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          order: it.order,
        })),
      },
    });
    // O registro fica na proposta NOVA, com a origem no `extra`.
    await this.audit.registrar({
      entity: 'PROPOSAL',
      entityId: nova.id,
      entityLabel: nova.number,
      action: 'NOVA_VERSAO',
      extra: { origemId: source.id, versao: nova.version },
    });
    return nova;
  }

  /** Gera PROP-AAAA-NNNN: max sequencial do ano corrente + 1, zero-padded a 4 dígitos. */
  private async generateNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const next = (await this.repo.maxSequenceForYear(year)) + 1;
    return `PROP-${year}-${String(next).padStart(4, '0')}`;
  }

  /** Carrega a proposta garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<ProposalWithItems> {
    const proposal = await this.repo.findById(id);
    if (!proposal) throw new NotFoundException('Proposta não encontrada.');
    await this.clients.findOne(ownerId, proposal.clientId); // 404 se não for do dono
    return proposal;
  }

  private assertTransition(from: ProposalStatus, to: ProposalStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new UnprocessableEntityException('Transição de status inválida.');
    }
  }

  /** Encontra o estágio isWon do owner e move o deal via DealsService. */
  private async moveDealToWon(ownerId: string, dealId: string): Promise<void> {
    const wonStage = await this.stages.wonStage(ownerId);
    if (!wonStage) return;
    const board = await this.deals.board(ownerId);
    const deal = board.find((d) => d.id === dealId);
    if (deal && deal.stageId !== wonStage.id) {
      await this.deals.move(ownerId, dealId, {
        stageId: wonStage.id,
        position: 0,
      });
    }
  }
}
