import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CLIENT_REPOSITORY,
  type ClientRepository,
  type ClientTagRef,
  type ClientWithAssignee,
} from '../domain/client.repository';
import { isValidDocument, onlyDigits } from '../../../shared/document';
import { normalizePage, paginated } from '../../../shared/pagination';
import { normalizeTag, type TagUsage } from '../../../shared/tags';
import { ALL_RECORDS, type AssigneeScope } from '../../../shared/record-scope';
import { assertArquivado, assertSemFilhos } from '../../../shared/purge';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateClientDto } from '../api/dto/create-client.dto';
import type { UpdateClientDto } from '../api/dto/update-client.dto';
import type { ListClientsQueryDto } from '../api/dto/list-clients-query.dto';

@Injectable()
export class ClientsService {
  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly repo: ClientRepository,
    private readonly members: WorkspaceMembersService,
    private readonly audit: AuditService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateClientDto,
  ): Promise<ClientWithAssignee> {
    // `assigneeId` entra pelo spread do DTO — sem esta linha, iria ao banco sem validação.
    await this.members.assertMember(ownerId, dto.assigneeId);
    const document = await this.resolveDocument(
      ownerId,
      dto.document,
      dto.personType,
    );
    return this.repo.create({ ...dto, document, ownerId });
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
      source: query.source,
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

  async update(
    ownerId: string,
    id: string,
    dto: UpdateClientDto,
  ): Promise<ClientWithAssignee> {
    await this.members.assertMember(ownerId, dto.assigneeId);
    const existing = await this.findOne(ownerId, id);
    const personType = dto.personType ?? existing.personType;
    const data: Omit<UpdateClientDto, 'document'> & {
      document?: string | null;
    } = { ...dto };
    if (dto.document !== undefined) {
      data.document = dto.document
        ? await this.resolveDocument(ownerId, dto.document, personType, id)
        : null;
    }
    return this.repo.update(id, ownerId, data);
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

  /** Valida formato e unicidade do documento; retorna só dígitos, ou undefined se vazio. */
  private async resolveDocument(
    ownerId: string,
    document: string | undefined,
    personType: 'INDIVIDUAL' | 'COMPANY',
    exceptId?: string,
  ): Promise<string | undefined> {
    if (!document) return undefined;
    const clean = onlyDigits(document);
    if (!isValidDocument(clean, personType)) {
      throw new BadRequestException(
        personType === 'INDIVIDUAL' ? 'CPF inválido.' : 'CNPJ inválido.',
      );
    }
    if (await this.repo.existsByDocument(ownerId, clean, exceptId)) {
      throw new ConflictException('Já existe um cliente com este documento.');
    }
    return clean;
  }
}
