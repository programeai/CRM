import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Client } from '@prisma/client';
import {
  CLIENT_REPOSITORY,
  type ClientRepository,
  type ClientTagRef,
} from '../domain/client.repository';
import { isValidDocument, onlyDigits } from '../../../shared/document';
import { normalizePage, paginated } from '../../../shared/pagination';
import { normalizeTag, type TagUsage } from '../../../shared/tags';
import type { CreateClientDto } from '../api/dto/create-client.dto';
import type { UpdateClientDto } from '../api/dto/update-client.dto';
import type { ListClientsQueryDto } from '../api/dto/list-clients-query.dto';

@Injectable()
export class ClientsService {
  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly repo: ClientRepository,
  ) {}

  async create(ownerId: string, dto: CreateClientDto): Promise<Client> {
    const document = await this.resolveDocument(
      ownerId,
      dto.document,
      dto.personType,
    );
    return this.repo.create({ ...dto, document, ownerId });
  }

  async list(ownerId: string, query: ListClientsQueryDto) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      status: query.status,
      source: query.source,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async findOne(ownerId: string, id: string): Promise<Client> {
    const client = await this.repo.findById(id, ownerId);
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateClientDto,
  ): Promise<Client> {
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

  async archive(ownerId: string, id: string): Promise<Client> {
    await this.findOne(ownerId, id);
    return this.repo.archive(id, ownerId);
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
