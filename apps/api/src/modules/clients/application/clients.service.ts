import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import type { PersonType } from '@prisma/client';
import {
  CLIENT_REPOSITORY,
  type ClientImportRef,
  type ClientRepository,
  type ClientTagRef,
  type ClientWithAssignee,
} from '../domain/client.repository';
import {
  CAMPOS_DE_ATRIBUICAO,
  type AtribuicaoDeAnuncio,
} from '../domain/ad-attribution';
import {
  inferPersonType,
  isValidDocument,
  onlyDigits,
} from '../../../shared/document';
import { normalizePage, paginated } from '../../../shared/pagination';
import { normalizeTag, type TagUsage } from '../../../shared/tags';
import { ALL_RECORDS, type AssigneeScope } from '../../../shared/record-scope';
import { assertArquivado, assertSemFilhos } from '../../../shared/purge';
import type { OpcoesDeEscrita } from '../../../shared/opcoes-de-escrita';
import {
  assertCabeNaExportacao,
  MAX_EXPORT_ROWS,
} from '../../../shared/export';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OwnerWebhooksEmitterService } from '../../webhooks/application/owner-webhooks-emitter.service';
import { EVENTO_POR_TIPO } from '../../webhooks/domain/owner-webhook-event';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import { ExportService } from '../../data/application/export.service';
import { assigneeMudou } from '../../../shared/assignee-changed';
import type { CreateClientDto } from '../api/dto/create-client.dto';
import type { UpdateClientDto } from '../api/dto/update-client.dto';
import type { ListClientsQueryDto } from '../api/dto/list-clients-query.dto';
import type { ExportClientsQueryDto } from '../api/dto/export-clients-query.dto';
import { COLUNAS_DE_CLIENTE } from './client-export-columns';

/*
  As opções de escrita subiram para `shared/opcoes-de-escrita.ts` quando a API
  pública passou a precisar da mesma coisa em `DealsService`, `ActivitiesService`
  e `TasksService`: o mesmo julgamento em quatro services pede um tipo só.
*/

@Injectable()
export class ClientsService {
  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly repo: ClientRepository,
    private readonly members: WorkspaceMembersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: OwnerWebhooksEmitterService,
    private readonly catalogos: CatalogosService,
    private readonly exporter: ExportService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateClientDto,
    opcoes: OpcoesDeEscrita = {},
  ): Promise<ClientWithAssignee> {
    // `assigneeId` entra pelo spread do DTO — sem esta linha, iria ao banco sem validação.
    await this.members.assertMember(ownerId, dto.assigneeId);
    // `sourceId` entra pelo spread do DTO. Sem esta linha, um id de outro owner
    // iria ao banco e estouraria na FK como 500 em vez de 404.
    if (dto.sourceId) {
      await this.catalogos.assertUtilizavel(
        ownerId,
        'fontes-de-lead',
        dto.sourceId,
      );
    }
    // Sem documento não há o que deduzir: `personType` fica indefinido e o
    // banco aplica o default do schema (COMPANY).
    const { document, personType } = await this.resolveDocument(
      ownerId,
      dto.document,
    );
    const criado = await this.repo.create({
      ...dto,
      document,
      personType,
      ownerId,
    });
    // Gatilho (f). Auto-atribuição é descartada dentro do `notificar`.
    if (dto.assigneeId && opcoes.avisarResponsavel !== false) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'CLIENT',
          entityId: criado.id,
          entityLabel: criado.name,
        },
      });
      // Gêmeo do aviso interno, para FORA da workspace. Mesma transação, mesmo
      // "engole a própria falha": webhook não pode derrubar a operação.
      await this.webhooks.emitir({
        evento: EVENTO_POR_TIPO.RECORD_ASSIGNED,
        entityId: criado.id,
        dados: {
          entidade: 'CLIENT',
          titulo: criado.name,
          responsavelId: dto.assigneeId,
          link: `/clientes/${criado.id}`,
        },
      });
    }
    return criado;
  }

  async list(
    ownerId: string,
    query: ListClientsQueryDto,
    scope: AssigneeScope = ALL_RECORDS,
  ) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      status: query.status,
      sourceId: query.sourceId,
      assigneeId: query.assigneeId,
      scope,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async findOne(
    ownerId: string,
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<ClientWithAssignee> {
    const client = await this.repo.findById(id, ownerId, scope);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  /**
   * Cliente do owner por telefone. Existe para a ingestão externa de lead
   * (`modules/leads`) reconhecer quem já está cadastrado antes de criar: é a
   * fronteira pública do módulo para esse caso, no lugar de outro módulo
   * consultar `Client` direto.
   */
  findByPhoneDigits(
    ownerId: string,
    digitos: string,
  ): Promise<ClientWithAssignee | null> {
    return this.repo.findByPhoneDigits(ownerId, digitos);
  }

  /** Fronteira pública para a importação de contatos casar o cliente. */
  listImportRefs(ownerId: string): Promise<ClientImportRef[]> {
    return this.repo.findAllRefs(ownerId);
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateClientDto,
    opcoes: OpcoesDeEscrita = {},
  ): Promise<ClientWithAssignee> {
    await this.members.assertMember(ownerId, dto.assigneeId);
    if (dto.sourceId) {
      await this.catalogos.assertUtilizavel(
        ownerId,
        'fontes-de-lead',
        dto.sourceId,
      );
    }
    const existing = await this.findOne(ownerId, id);
    const data: Omit<UpdateClientDto, 'document'> & {
      document?: string | null;
      personType?: PersonType;
    } = { ...dto };
    // Trocar o documento reclassifica a pessoa; limpá-lo preserva a
    // classificação atual, porque não sobrou de onde deduzir outra.
    if (dto.document !== undefined) {
      const resolvido = await this.resolveDocument(ownerId, dto.document, id);
      data.document = resolvido.document ?? null;
      if (resolvido.personType) data.personType = resolvido.personType;
    }
    const atualizado = await this.repo.update(id, ownerId, data);
    if (
      assigneeMudou(dto.assigneeId, existing.assigneeId) &&
      opcoes.avisarResponsavel !== false
    ) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'CLIENT',
          entityId: id,
          entityLabel: atualizado.name,
        },
      });
      await this.webhooks.emitir({
        evento: EVENTO_POR_TIPO.RECORD_ASSIGNED,
        entityId: id,
        dados: {
          entidade: 'CLIENT',
          titulo: atualizado.name,
          responsavelId: dto.assigneeId,
          link: `/clientes/${id}`,
        },
      });
    }
    return atualizado;
  }

  /**
   * Promove o cliente de `LEAD` para `ACTIVE` — fronteira pública do módulo para
   * quem ganha o negócio (`DealsService.move` ao entrar em estágio `isWon` e
   * `ProposalsService.accept`, que cobre a proposta sem oportunidade).
   *
   * Por que um método próprio, e não `update({ status: 'ACTIVE' })`: aqui a
   * regra é do MÓDULO DE CLIENTES, não de quem chama — só promove quem ainda é
   * lead, e nunca rebaixa. Cliente já `ACTIVE` não é reescrito (o `updatedAt`
   * mentiria), e `INACTIVE`/`LOST` **não** são tocados: reativar quem foi
   * marcado como perdido é decisão de pessoa, com contexto que o CRM não tem.
   * Por isso é idempotente e silencioso — mover o card para dentro e para fora
   * do ganho não gera duas linhas de trilha.
   *
   * Perder o negócio não tem simétrico de propósito: um deal perdido não faz o
   * cliente virar `LOST` (ele pode ter outros três em aberto).
   */
  async promoverParaAtivo(ownerId: string, id: string): Promise<void> {
    const client = await this.findOne(ownerId, id);
    if (client.status !== 'LEAD') return;
    await this.repo.update(id, ownerId, { status: 'ACTIVE' });
    await this.audit.registrar({
      entity: 'CLIENT',
      entityId: id,
      entityLabel: client.name,
      action: 'ATUALIZAR',
      antes: { status: 'LEAD' },
      depois: { status: 'ACTIVE' },
    });
  }

  /**
   * Grava a atribuição de anúncio do clique que trouxe o lead — fronteira
   * pública do módulo para a ingestão externa (`modules/leads`).
   *
   * Por que um método próprio, e não `update({ … })`: aqui a regra é do MÓDULO
   * DE CLIENTES, não de quem chama. **Só preenche coluna vazia.** A 17-A
   * decidiu que origem, tags e fonte contam de onde o cadastro veio na PRIMEIRA
   * vez, e atribuição segue a mesma lei — o clique que trouxe a pessoa de volta
   * não apaga o que a trouxe originalmente. Mas as colunas nasceram nulas nesta
   * fase, então um cadastro anterior ao deploy precisa PODER recebê-las quando o
   * lead volta; preencher-só-o-vazio é o que satisfaz as duas coisas de uma vez.
   *
   * Idempotente e silencioso, como `promoverParaAtivo`: sem lacuna a preencher
   * não escreve nada (o `updatedAt` mentiria) e não registra trilha — não há
   * ação de pessoa a auditar, e `AuditLog` retém 5 anos contra o "enquanto a
   * conta existir" do `Client`.
   *
   * Não existe porta autenticada para estes campos: eles não estão em
   * `CreateClientDto` nem em `UpdateClientDto`. É assim que "somente leitura" é
   * uma verdade da fronteira HTTP, e não uma convenção que o próximo PR quebra.
   */
  async registrarAtribuicao(
    ownerId: string,
    id: string,
    atribuicao: AtribuicaoDeAnuncio,
  ): Promise<void> {
    const atual = await this.findOne(ownerId, id);
    const patch: Record<string, string | Date> = {};
    for (const campo of CAMPOS_DE_ATRIBUICAO) {
      const valor = atribuicao[campo];
      if (valor !== null && atual[campo] === null) patch[campo] = valor;
    }
    if (Object.keys(patch).length === 0) return;
    await this.repo.update(id, ownerId, patch);
  }

  async archive(ownerId: string, id: string): Promise<ClientWithAssignee> {
    const client = await this.findOne(ownerId, id);
    const arquivado = await this.repo.archive(id, ownerId);
    await this.audit.registrar({
      entity: 'CLIENT',
      entityId: id,
      entityLabel: client.name,
      action: 'ARQUIVAR',
    });
    return arquivado;
  }

  /** Devolve o cliente à área de trabalho. */
  async restore(ownerId: string, id: string): Promise<ClientWithAssignee> {
    const client = await this.findOne(ownerId, id);
    const restaurado = await this.repo.restore(id, ownerId);
    await this.audit.registrar({
      entity: 'CLIENT',
      entityId: id,
      entityLabel: client.name,
      action: 'RESTAURAR',
    });
    return restaurado;
  }

  /**
   * Expurgo de cliente. TODAS as FKs de filho para Client são RESTRICT
   * (contatos, atividades, oportunidades, propostas, projetos, contratos) — ver
   * specs/research/2026-07-21-fase-1-clientes.md:140. A contagem é somada e a
   * mensagem cita o que sobrou, senão o usuário tenta N vezes sem saber o motivo.
   */
  async purge(ownerId: string, id: string): Promise<void> {
    const client = await this.findOne(ownerId, id);
    assertArquivado(client.archivedAt, 'um cliente');
    const vinculos = await this.repo.countChildren(id);
    assertSemFilhos(
      vinculos.total,
      `Não é possível excluir em definitivo um cliente com registros vinculados (${vinculos.descricao}). Expurgue-os primeiro.`,
    );
    await this.repo.delete(id);
    await this.audit.registrar({
      entity: 'CLIENT',
      entityId: id,
      entityLabel: client.name,
      action: 'EXPURGAR',
    });
  }

  /** Tags existentes do dono (agregadas dos clientes) com contagem de uso. */
  listTags(ownerId: string): Promise<TagUsage[]> {
    return this.repo.listOwnerTags(ownerId);
  }

  /** Clientes do dono que usam a tag — para exibir o uso antes de excluir. */
  tagUsage(ownerId: string, tag: string): Promise<ClientTagRef[]> {
    return this.repo.findByTag(ownerId, normalizeTag(tag));
  }

  /** Exclui a tag de todos os clientes do dono. Retorna quantos foram afetados. */
  async deleteTag(ownerId: string, tag: string): Promise<{ removed: number }> {
    const removed = await this.repo.removeTagFromAll(
      ownerId,
      normalizeTag(tag),
    );
    return { removed };
  }

  /**
   * Exportação da listagem. Reusa o MESMO `filter` + `scope` de `list()` — é o
   * que garante que a planilha respeite o recorte por responsável, que o banco
   * não protege. O `take` alto substitui a paginação; o `total` do próprio
   * `findManyAndCount` diz se o filtro cabe no teto.
   */
  async export(
    ownerId: string,
    query: ExportClientsQueryDto,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<StreamableFile> {
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      status: query.status,
      sourceId: query.sourceId,
      assigneeId: query.assigneeId,
      scope,
      skip: 0,
      take: MAX_EXPORT_ROWS,
    });
    assertCabeNaExportacao(total);
    return this.exporter.gerar(
      data,
      COLUNAS_DE_CLIENTE,
      query.formato,
      'clientes',
    );
  }

  /**
   * Valida formato e unicidade do documento e deduz dele o tipo de pessoa —
   * quem cadastra informa só o documento, a classificação é consequência.
   * Retorna só os dígitos; documento vazio devolve o par indefinido.
   */
  private async resolveDocument(
    ownerId: string,
    document: string | undefined,
    exceptId?: string,
  ): Promise<{ document?: string; personType?: PersonType }> {
    if (!document) return {};
    const clean = onlyDigits(document);
    const personType = inferPersonType(clean);
    if (!personType) {
      throw new BadRequestException(
        'Documento inválido: informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).',
      );
    }
    if (!isValidDocument(clean, personType)) {
      throw new BadRequestException(
        personType === 'INDIVIDUAL' ? 'CPF inválido.' : 'CNPJ inválido.',
      );
    }
    if (await this.repo.existsByDocument(ownerId, clean, exceptId)) {
      throw new ConflictException('Já existe um cliente com este documento.');
    }
    return { document: clean, personType };
  }
}
