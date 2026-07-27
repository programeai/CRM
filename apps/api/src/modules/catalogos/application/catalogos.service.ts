import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CATALOG_LABELS,
  KIND_COM_FOLLOW_UP,
  type CatalogKind,
} from '../domain/catalog-kind';
import {
  CATALOG_REPOSITORY,
  type CatalogItem,
  type CatalogRepository,
} from '../domain/catalog.repository';
import type { CreateCatalogItemDto } from '../api/dto/create-catalog-item.dto';
import type { UpdateCatalogItemDto } from '../api/dto/update-catalog-item.dto';

@Injectable()
export class CatalogosService {
  private readonly logger = new Logger(CatalogosService.name);

  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly repo: CatalogRepository,
  ) {}

  list(
    ownerId: string,
    kind: CatalogKind,
    incluirInativos = false,
  ): Promise<CatalogItem[]> {
    return this.repo.findAll(kind, ownerId, incluirInativos);
  }

  /**
   * Item do owner ou 404. É o `stages.findOne` desta fase: os módulos de negócio
   * chamam este método antes de gravar a FK, para que id de outro owner (ou
   * inexistente) responda 404 em vez de estourar na FK como 500.
   */
  async findOne(
    ownerId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<CatalogItem> {
    const item = await this.repo.findById(kind, id, ownerId);
    if (!item) {
      throw new NotFoundException(
        `${maiuscula(CATALOG_LABELS[kind])} não encontrado no catálogo.`,
      );
    }
    return item;
  }

  /**
   * Valida que o item pertence ao owner **e** está utilizável para uma escrita
   * nova. Item desativado continua rotulando registro antigo, mas não pode ser
   * escolhido num cadastro novo — senão a desativação não significaria nada.
   */
  async assertUtilizavel(
    ownerId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<CatalogItem> {
    const item = await this.findOne(ownerId, kind, id);
    if (!item.active) {
      throw new UnprocessableEntityException(
        `Este ${CATALOG_LABELS[kind]} está desativado. Reative-o no catálogo ou escolha outro.`,
      );
    }
    return item;
  }

  async create(
    ownerId: string,
    kind: CatalogKind,
    dto: CreateCatalogItemDto,
  ): Promise<CatalogItem> {
    const name = dto.name.trim();
    if (await this.repo.findByName(kind, ownerId, name)) {
      throw new ConflictException(
        `Já existe um ${CATALOG_LABELS[kind]} com este nome.`,
      );
    }
    this.assertFollowUpPermitido(kind, dto.isFollowUp);
    const criado = await this.repo.create(kind, {
      ownerId,
      name,
      ...(dto.isFollowUp !== undefined ? { isFollowUp: dto.isFollowUp } : {}),
    });
    if (dto.isFollowUp) {
      await this.repo.desmarcarOutrosFollowUp(ownerId, criado.id);
    }
    this.logger.log({
      evento: 'catalogo.item_criado',
      msg: 'Item de catálogo criado.',
      catalogo: kind,
      itemId: criado.id,
    });
    return criado;
  }

  async update(
    ownerId: string,
    kind: CatalogKind,
    id: string,
    dto: UpdateCatalogItemDto,
  ): Promise<CatalogItem> {
    const item = await this.findOne(ownerId, kind, id);
    const name = dto.name?.trim();
    if (name && name !== item.name) {
      if (await this.repo.findByName(kind, ownerId, name)) {
        throw new ConflictException(
          `Já existe um ${CATALOG_LABELS[kind]} com este nome.`,
        );
      }
    }
    this.assertFollowUpPermitido(kind, dto.isFollowUp);
    const atualizado = await this.repo.update(kind, id, ownerId, {
      ...(name ? { name } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.isFollowUp !== undefined ? { isFollowUp: dto.isFollowUp } : {}),
    });
    if (dto.isFollowUp) {
      await this.repo.desmarcarOutrosFollowUp(ownerId, id);
    }
    this.logger.log({
      evento: 'catalogo.item_atualizado',
      msg: 'Item de catálogo atualizado.',
      catalogo: kind,
      itemId: id,
    });
    return atualizado;
  }

  /**
   * Hard delete com guard: item em uso não é apagado. A mensagem instrui a
   * desativar — é a saída para o owner que já usou o item e não pode apagá-lo.
   */
  async delete(ownerId: string, kind: CatalogKind, id: string): Promise<void> {
    await this.findOne(ownerId, kind, id);
    const usos = await this.repo.contarUsos(kind, id, ownerId);
    if (usos > 0) {
      throw new ConflictException(
        `Não é possível excluir um ${CATALOG_LABELS[kind]} em uso por ${usos} registro(s), inclusive arquivados. Desative-o para tirá-lo dos formulários sem perder o histórico.`,
      );
    }
    await this.repo.delete(kind, id, ownerId);
    this.logger.log({
      evento: 'catalogo.item_excluido',
      msg: 'Item de catálogo excluído.',
      catalogo: kind,
      itemId: id,
    });
  }

  /**
   * `isFollowUp` é regra de um catálogo só. Aceitar o campo nos outros gravaria
   * uma coluna que não existe (500 do Prisma) — 422 é a resposta honesta.
   */
  private assertFollowUpPermitido(kind: CatalogKind, valor?: boolean): void {
    if (valor !== undefined && kind !== KIND_COM_FOLLOW_UP) {
      throw new UnprocessableEntityException(
        'Marcar follow-up só vale para tipos de atividade.',
      );
    }
  }
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
