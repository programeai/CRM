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

  /**
   * Só os itens vivos por padrão. Não existe "listar excluídos" na UI: para
   * quem usa o CRM, item oculto foi excluído — o nome dele sobrevive apenas
   * embutido nos registros que já o carregavam. `incluirInativos` existe só
   * para o resolvedor de catálogo da importação (Fase 14-A): casar a planilha
   * com um item desativado é legítimo, diferente de exibi-lo num Select.
   */
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
   * nova. Item excluído continua rotulando registro antigo, mas não pode ser
   * escolhido num cadastro novo — senão a exclusão não significaria nada.
   */
  async assertUtilizavel(
    ownerId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<CatalogItem> {
    const item = await this.findOne(ownerId, kind, id);
    if (!item.active) {
      throw new UnprocessableEntityException(
        `Este ${CATALOG_LABELS[kind]} foi excluído. Escolha outro ou cadastre-o novamente.`,
      );
    }
    return item;
  }

  /**
   * Cadastra — ou **ressuscita**. Um item excluído em uso continua no banco
   * (`active: false`) para não derrubar as FKs `RESTRICT`, e o
   * `@@unique([ownerId, name])` faria um cadastro com o mesmo nome bater numa
   * linha que ninguém enxerga. Em vez de um 409 impossível de entender, o
   * cadastro reativa a linha: os registros antigos reencontram o item.
   */
  async create(
    ownerId: string,
    kind: CatalogKind,
    dto: CreateCatalogItemDto,
  ): Promise<CatalogItem> {
    const name = dto.name.trim();
    const existente = await this.repo.findByName(kind, ownerId, name);
    if (existente?.active) {
      throw new ConflictException(
        `Já existe um ${CATALOG_LABELS[kind]} com este nome.`,
      );
    }
    this.assertFollowUpPermitido(kind, dto.isFollowUp);

    if (existente) {
      const revivido = await this.repo.update(kind, existente.id, ownerId, {
        active: true,
        ...(dto.isFollowUp !== undefined ? { isFollowUp: dto.isFollowUp } : {}),
      });
      if (dto.isFollowUp) {
        await this.repo.desmarcarOutrosFollowUp(ownerId, existente.id);
      }
      this.logger.log({
        evento: 'catalogo.item_restaurado',
        msg: 'Item de catálogo restaurado por novo cadastro com o mesmo nome.',
        catalogo: kind,
        itemId: existente.id,
      });
      return revivido;
    }

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

  /**
   * A única edição que existe é mover a marca de follow-up. **Renomear não é
   * uma operação do produto**: para trocar um nome, exclui-se o item e
   * cadastra-se outro — e o histórico continua exibindo o nome que valia quando
   * cada registro foi classificado, como no log de auditoria.
   */
  async update(
    ownerId: string,
    kind: CatalogKind,
    id: string,
    dto: UpdateCatalogItemDto,
  ): Promise<CatalogItem> {
    await this.findOne(ownerId, kind, id);
    this.assertFollowUpPermitido(kind, dto.isFollowUp);
    const atualizado = await this.repo.update(kind, id, ownerId, {
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
   * Excluir sempre funciona — o que muda é o quanto sobra no banco.
   *
   * Sem nenhum registro apontando, some de verdade. Em uso, as FKs `RESTRICT`
   * (e três delas NOT NULL: `Deal`, `Proposal`, `Project`) tornam o DELETE
   * impossível sem apagar o histórico junto, então o item vira `active: false`:
   * sai do catálogo e de todos os Select, e os registros antigos continuam
   * exibindo o nome que valia quando foram classificados.
   *
   * Para quem usa o CRM os dois casos são "excluí" — não existe estado
   * intermediário na interface. `usos` volta para a mensagem poder ser honesta
   * sobre o que aconteceu com o histórico.
   */
  async delete(
    ownerId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<{ ocultado: boolean; usos: number }> {
    await this.findOne(ownerId, kind, id);
    const usos = await this.repo.contarUsos(kind, id, ownerId);

    if (usos > 0) {
      await this.repo.update(kind, id, ownerId, { active: false });
      this.logger.log({
        evento: 'catalogo.item_ocultado',
        msg: 'Item de catálogo em uso ocultado no lugar da exclusão.',
        catalogo: kind,
        itemId: id,
        usos,
      });
      return { ocultado: true, usos };
    }

    await this.repo.delete(kind, id, ownerId);
    this.logger.log({
      evento: 'catalogo.item_excluido',
      msg: 'Item de catálogo excluído.',
      catalogo: kind,
      itemId: id,
    });
    return { ocultado: false, usos: 0 };
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
