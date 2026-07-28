import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import {
  IntegrationKeysService,
  type ChaveParaApi,
} from '../../integracoes/application/integration-keys.service';
import { ESCOPO_RECEBER_LEAD } from '../../integracoes/domain/integration-scope';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import {
  LEAD_INTAKE_CHANNEL_REPOSITORY,
  type LeadIntakeChannelRecord,
  type LeadIntakeChannelRepository,
} from '../domain/lead-intake-channel.repository';
import type { CreateLeadIntakeChannelDto } from '../api/dto/create-lead-intake-channel.dto';
import type { UpdateLeadIntakeChannelDto } from '../api/dto/update-lead-intake-channel.dto';

/** O canal como a interface o exibe — nomes resolvidos, chave mascarada. */
export interface CanalParaApi {
  id: string;
  name: string;
  assignee: { id: string; name: string } | null;
  source: { id: string; name: string; active: boolean } | null;
  chave: ChaveParaApi | null;
  createdAt: Date;
}

/** Criação: a ÚNICA resposta que carrega o valor bruto da chave. */
export interface CanalCriado {
  canal: CanalParaApi;
  /** Existe uma vez. A tela exibe e não relê. */
  chave: string;
}

/**
 * Canais de captação do owner.
 *
 * Canal e chave nascem e morrem juntos: criar um canal emite a chave (e é a
 * única vez que o valor bruto existe), apagar o canal apaga a chave. Canal sem
 * chave não recebe nada, e chave com escopo `lead:receber` sem canal gravaria
 * lead sem roteamento e sem fonte — nenhum dos dois estados serve.
 */
@Injectable()
export class LeadIntakeChannelsService {
  private readonly logger = new Logger(LeadIntakeChannelsService.name);

  constructor(
    @Inject(LEAD_INTAKE_CHANNEL_REPOSITORY)
    private readonly repo: LeadIntakeChannelRepository,
    private readonly keys: IntegrationKeysService,
    private readonly members: WorkspaceMembersService,
    private readonly catalogos: CatalogosService,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string): Promise<CanalParaApi[]> {
    const canais = await this.repo.findManyByOwner(ownerId);
    return this.compor(ownerId, canais);
  }

  /** O canal que a chave autentica. Fronteira usada pela ingestão. */
  findByKeyId(
    ownerId: string,
    keyId: string,
  ): Promise<LeadIntakeChannelRecord | null> {
    return this.repo.findByKeyId(ownerId, keyId);
  }

  async create(
    ownerId: string,
    dto: CreateLeadIntakeChannelDto,
  ): Promise<CanalCriado> {
    await this.validar(ownerId, dto);
    await this.assertNomeLivre(ownerId, dto.name);
    // A chave primeiro: se a emissão falhar, não sobra canal mudo no banco.
    const emitida = await this.keys.emitir({
      ownerId,
      name: dto.name,
      scopes: [ESCOPO_RECEBER_LEAD],
    });
    const canal = await this.repo.create({
      ownerId,
      name: dto.name.trim(),
      assigneeId: dto.assigneeId ?? null,
      sourceId: dto.sourceId ?? null,
      keyId: emitida.chave.id,
    });
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: canal.id,
      entityLabel: canal.name,
      action: 'CRIAR',
      extra: { canalDeCaptacao: true, chaveId: emitida.chave.id },
    });
    this.logger.log({
      evento: 'lead.canal_criado',
      msg: 'Canal de captação de lead criado.',
      canalId: canal.id,
      chaveId: emitida.chave.id,
      roteado: Boolean(canal.assigneeId),
    });
    const [paraApi] = await this.compor(ownerId, [canal]);
    // `valor` só existe aqui. A tela exibe uma vez e não relê.
    return { canal: paraApi, chave: emitida.valor };
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateLeadIntakeChannelDto,
  ): Promise<CanalParaApi> {
    const atual = await this.assertDoOwner(ownerId, id);
    await this.validar(ownerId, dto);
    if (dto.name !== undefined && dto.name.trim() !== atual.name) {
      await this.assertNomeLivre(ownerId, dto.name);
    }
    const atualizado = await this.repo.update(ownerId, id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
      ...(dto.sourceId !== undefined ? { sourceId: dto.sourceId } : {}),
    });
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: id,
      entityLabel: atualizado.name,
      action: 'ATUALIZAR',
      antes: { ...atual },
      depois: { ...atualizado },
    });
    this.logger.log({
      evento: 'lead.canal_atualizado',
      msg: 'Canal de captação de lead atualizado.',
      canalId: id,
      roteado: Boolean(atualizado.assigneeId),
    });
    const [paraApi] = await this.compor(ownerId, [atualizado]);
    return paraApi;
  }

  /** Apaga o canal E a chave: credencial órfã continuaria autenticando. */
  async delete(ownerId: string, id: string): Promise<void> {
    const canal = await this.assertDoOwner(ownerId, id);
    await this.repo.delete(ownerId, id);
    if (canal.keyId) await this.keys.apagar(ownerId, canal.keyId);
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: id,
      entityLabel: canal.name,
      action: 'EXCLUIR',
      extra: { canalDeCaptacao: true },
    });
    this.logger.log({
      evento: 'lead.canal_excluido',
      msg: 'Canal de captação de lead excluído: a chave dele deixou de valer.',
      canalId: id,
      chaveId: canal.keyId,
    });
  }

  /**
   * Responsável tem de ser membro da workspace (`User` não tem RLS — este é o
   * único portão) e fonte de lead tem de estar utilizável.
   */
  private async validar(
    ownerId: string,
    dto: { assigneeId?: string | null; sourceId?: string | null },
  ): Promise<void> {
    await this.members.assertMember(ownerId, dto.assigneeId);
    if (dto.sourceId) {
      await this.catalogos.assertUtilizavel(
        ownerId,
        'fontes-de-lead',
        dto.sourceId,
      );
    }
  }

  /**
   * `@@unique([ownerId, name])` responderia 500 do Prisma (P2002). 409 com a
   * mensagem em pt-BR é a resposta honesta.
   */
  private async assertNomeLivre(ownerId: string, name: string): Promise<void> {
    const canais = await this.repo.findManyByOwner(ownerId);
    if (canais.some((c) => c.name === name.trim())) {
      throw new ConflictException(
        'Já existe um canal de captação com este nome.',
      );
    }
  }

  private async assertDoOwner(
    ownerId: string,
    id: string,
  ): Promise<LeadIntakeChannelRecord> {
    const canal = await this.repo.findById(ownerId, id);
    if (!canal)
      throw new NotFoundException('Canal de captação não encontrado.');
    return canal;
  }

  /**
   * Resolve os nomes pelos services que os módulos vizinhos exportam, em vez de
   * fazer join a partir daqui: `LeadIntakeChannel` é a única tabela deste
   * módulo, e o resto vem pela fronteira pública de `workspace`, `catalogos` e
   * `integracoes`. A tela é de administração, com unidades de linha — o custo
   * das três consultas é irrelevante frente à fronteira preservada.
   *
   * Fonte de lead **inativa** entra na busca (`incluirInativos`): um canal
   * configurado com uma fonte que depois foi excluída precisa continuar
   * dizendo qual era.
   */
  private async compor(
    ownerId: string,
    canais: LeadIntakeChannelRecord[],
  ): Promise<CanalParaApi[]> {
    if (canais.length === 0) return [];
    const [membros, fontes, chaves] = await Promise.all([
      this.members.list(ownerId),
      this.catalogos.list(ownerId, 'fontes-de-lead', true),
      this.keys.list(ownerId),
    ]);
    const porId = <T extends { id: string }>(itens: T[]) =>
      new Map(itens.map((i) => [i.id, i]));
    const membroPorId = porId(membros);
    const fontePorId = porId(fontes);
    const chavePorId = porId(chaves);

    return canais.map((canal) => {
      const membro = canal.assigneeId
        ? membroPorId.get(canal.assigneeId)
        : undefined;
      const fonte = canal.sourceId ? fontePorId.get(canal.sourceId) : undefined;
      const chave = canal.keyId ? chavePorId.get(canal.keyId) : undefined;
      return {
        id: canal.id,
        name: canal.name,
        assignee: membro ? { id: membro.id, name: membro.name } : null,
        source: fonte
          ? { id: fonte.id, name: fonte.name, active: fonte.active }
          : null,
        chave: chave ?? null,
        createdAt: canal.createdAt,
      };
    });
  }
}
