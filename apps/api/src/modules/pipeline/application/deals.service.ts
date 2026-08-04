import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEAL_REPOSITORY,
  type DealRepository,
  type DealWithClient,
} from '../domain/deal.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { ActivitiesService } from '../../activities/application/activities.service';
import { PipelineStagesService } from './pipeline-stages.service';
import { ProjectsService } from '../../projects/application/projects.service';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OwnerWebhooksEmitterService } from '../../webhooks/application/owner-webhooks-emitter.service';
import { EVENTO_POR_TIPO } from '../../webhooks/domain/owner-webhook-event';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import { assertArquivado } from '../../../shared/purge';
import { normalizePage, paginated } from '../../../shared/pagination';
import { assigneeMudou } from '../../../shared/assignee-changed';
import { ALL_RECORDS, type AssigneeScope } from '../../../shared/record-scope';
import type { OpcoesDeEscrita } from '../../../shared/opcoes-de-escrita';
import type { CreateDealDto } from '../api/dto/create-deal.dto';
import type { UpdateDealDto } from '../api/dto/update-deal.dto';
import type { ListDealsQueryDto } from '../api/dto/list-deals-query.dto';
import type { MoveDealDto } from '../api/dto/move-deal.dto';

/** Card do quadro: o deal mais o sinal do próximo passo. Ver `board`. */
export type DealBoardCard = DealWithClient & { nextActivityAt: Date | null };

@Injectable()
export class DealsService {
  constructor(
    @Inject(DEAL_REPOSITORY) private readonly repo: DealRepository,
    private readonly clients: ClientsService,
    private readonly activities: ActivitiesService,
    private readonly stages: PipelineStagesService,
    private readonly projects: ProjectsService,
    private readonly members: WorkspaceMembersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: OwnerWebhooksEmitterService,
    private readonly catalogos: CatalogosService,
  ) {}

  async list(
    ownerId: string,
    query: ListDealsQueryDto,
    scope: AssigneeScope = ALL_RECORDS,
  ) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      stageId: query.stageId,
      search: query.search,
      assigneeId: query.assigneeId,
      scope,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  /**
   * Quadro do funil. Cada card leva `nextActivityAt` — o próximo follow-up
   * pendente da oportunidade, ou `null` quando não há nenhum agendado. É esse
   * campo que faz o quadro responder "o que eu faço agora", e não só "quanto
   * vale": sem ele o card só alerta inércia de estágio (`stageMovedAt`).
   *
   * `atividadeScope` é o recorte de ATIVIDADE (`cliente:ver_todos`), separado do
   * `scope` de oportunidade (`oportunidade:ver_todas`) — as duas chaves são
   * independentes e um colaborador pode ter uma sem a outra.
   */
  async board(
    ownerId: string,
    scope: AssigneeScope = ALL_RECORDS,
    assigneeId?: string,
    atividadeScope: AssigneeScope = ALL_RECORDS,
  ): Promise<DealBoardCard[]> {
    const deals = await this.repo.findAllForBoard(ownerId, scope, assigneeId);
    // Uma consulta agregada para o quadro inteiro, não uma por card.
    const proximas = await this.activities.proximaPorDeal(
      ownerId,
      deals.map((d) => d.id),
      atividadeScope,
    );
    return deals.map((deal) => ({
      ...deal,
      nextActivityAt: proximas.get(deal.id) ?? null,
    }));
  }

  async findOne(
    ownerId: string,
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<DealWithClient> {
    return this.loadOwned(ownerId, id, scope);
  }

  async create(
    ownerId: string,
    dto: CreateDealDto,
    opcoes: OpcoesDeEscrita = {},
  ): Promise<DealWithClient> {
    await this.clients.findOne(ownerId, dto.clientId); // valida que o cliente é do dono
    await this.members.assertMember(ownerId, dto.assigneeId);
    await this.catalogos.assertUtilizavel(
      ownerId,
      'servicos',
      dto.serviceTypeId,
    );
    const stage = dto.stageId
      ? await this.stages.findOne(ownerId, dto.stageId)
      : await this.stages.firstStage(ownerId);
    const position = (await this.repo.maxPositionInStage(stage.id)) + 1;
    const criado = await this.repo.create({
      ownerId,
      clientId: dto.clientId,
      stageId: stage.id,
      title: dto.title,
      serviceTypeId: dto.serviceTypeId,
      amount: dto.amount ?? null,
      probability: dto.probability ?? null,
      expectedClose: dto.expectedClose ? new Date(dto.expectedClose) : null,
      assigneeId: dto.assigneeId ?? null,
      position,
    });
    // Gatilho (f). DEPOIS da escrita e na MESMA transação do request: a
    // notificação commita junto com a atribuição, ou nenhuma das duas commita.
    // Auto-atribuição é descartada dentro do `notificar`.
    if (dto.assigneeId && opcoes.avisarResponsavel !== false) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: criado.id,
          entityLabel: criado.title,
        },
      });
      // Gêmeo do aviso interno, para FORA da workspace. Mesma transação, mesmo
      // "engole a própria falha": webhook não pode derrubar a operação.
      await this.webhooks.emitir({
        evento: EVENTO_POR_TIPO.RECORD_ASSIGNED,
        entityId: criado.id,
        dados: {
          entidade: 'DEAL',
          titulo: criado.title,
          responsavelId: dto.assigneeId,
          link: '/pipeline',
        },
      });
    }
    return criado;
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateDealDto,
  ): Promise<DealWithClient> {
    const antes = await this.loadOwned(ownerId, id);
    await this.members.assertMember(ownerId, dto.assigneeId);
    if (dto.serviceTypeId !== undefined) {
      await this.catalogos.assertUtilizavel(
        ownerId,
        'servicos',
        dto.serviceTypeId,
      );
    }
    const atualizado = await this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.serviceTypeId !== undefined
        ? { serviceTypeId: dto.serviceTypeId }
        : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.probability !== undefined
        ? { probability: dto.probability }
        : {}),
      ...(dto.expectedClose !== undefined
        ? {
            expectedClose: dto.expectedClose
              ? new Date(dto.expectedClose)
              : null,
          }
        : {}),
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
    });
    if (assigneeMudou(dto.assigneeId, antes.assigneeId)) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'DEAL',
          entityId: id,
          entityLabel: atualizado.title,
        },
      });
      await this.webhooks.emitir({
        evento: EVENTO_POR_TIPO.RECORD_ASSIGNED,
        entityId: id,
        dados: {
          entidade: 'DEAL',
          titulo: atualizado.title,
          responsavelId: dto.assigneeId,
          link: '/pipeline',
        },
      });
    }
    return atualizado;
  }

  async move(
    ownerId: string,
    id: string,
    dto: MoveDealDto,
  ): Promise<DealWithClient> {
    const deal = await this.loadOwned(ownerId, id);
    const targetStage = await this.stages.findOne(ownerId, dto.stageId);
    const stageChanged = deal.stageId !== dto.stageId;

    const patch: { stageMovedAt?: Date; lostReasonId?: string | null } = {};
    if (stageChanged) patch.stageMovedAt = new Date();
    if (targetStage.isLost) {
      if (!dto.lostReasonId)
        throw new UnprocessableEntityException('Informe o motivo da perda.');
      // Motivo de outro owner (ou desativado) não pode entrar na FK.
      await this.catalogos.assertUtilizavel(
        ownerId,
        'motivos-de-perda',
        dto.lostReasonId,
      );
      patch.lostReasonId = dto.lostReasonId;
    } else if (stageChanged) {
      patch.lostReasonId = null; // saiu de "Perdeu" → limpa o motivo
    }

    const moved = await this.repo.move(id, dto.stageId, dto.position, patch);

    // Criar-ao-ganhar: ao entrar num estágio isWon, semeia um Project (idempotente).
    if (targetStage.isWon && stageChanged) {
      await this.projects.createFromDeal(moved);
      // E o cliente deixa de ser lead: quem fecha negócio é cliente ativo. Mesmo
      // gatilho, porque é o mesmo fato — e idempotente do lado de lá, então
      // mover para dentro e para fora do ganho não repete nada.
      await this.clients.promoverParaAtivo(ownerId, moved.clientId);
    }
    return moved;
  }

  /** Manda a oportunidade para a lixeira. Substitui o antigo hard delete. */
  async archive(ownerId: string, id: string): Promise<DealWithClient> {
    const deal = await this.loadOwned(ownerId, id);
    const arquivado = await this.repo.archive(id);
    await this.audit.registrar({
      entity: 'DEAL',
      entityId: id,
      entityLabel: deal.title,
      action: 'ARQUIVAR',
    });
    return arquivado;
  }

  /** Devolve a oportunidade ao funil, na posição em que estava. */
  async restore(ownerId: string, id: string): Promise<DealWithClient> {
    const deal = await this.loadOwned(ownerId, id, ALL_RECORDS, true);
    const restaurado = await this.repo.restore(id);
    await this.audit.registrar({
      entity: 'DEAL',
      entityId: id,
      entityLabel: deal.title,
      action: 'RESTAURAR',
    });
    return restaurado;
  }

  /**
   * Expurgo: apaga de vez. `Proposal.dealId`, `Project.dealId` e
   * `Activity.dealId` são FKs opcionais com SET NULL, então nenhum filho
   * bloqueia — os registros vinculados sobrevivem sem a oportunidade.
   */
  async purge(ownerId: string, id: string): Promise<void> {
    const deal = await this.loadOwned(ownerId, id, ALL_RECORDS, true);
    assertArquivado(deal.archivedAt, 'uma oportunidade');
    await this.repo.delete(id);
    await this.audit.registrar({
      entity: 'DEAL',
      entityId: id,
      entityLabel: deal.title,
      action: 'EXPURGAR',
    });
  }

  /**
   * Carrega o deal garantindo que o cliente pertence ao usuário (404 caso contrário).
   * `scope` só é passado nas leituras: escrita não é recortada por responsável.
   */
  private async loadOwned(
    ownerId: string,
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
    includeArchived = false,
  ): Promise<DealWithClient> {
    const deal = await this.repo.findById(id, scope, includeArchived);
    if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
    await this.clients.findOne(ownerId, deal.clientId); // 404 se não for do dono
    return deal;
  }
}
