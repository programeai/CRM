import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import {
  INTEGRATION_KEY_REPOSITORY,
  type IntegrationKeyRecord,
  type IntegrationKeyRepository,
} from '../domain/integration-key.repository';
import { isIntegrationScope } from '../domain/integration-scope';

/** Prefixo do valor bruto. Reconhecível num grep de segredo vazado. */
const PREFIXO = 'crm_';
/** `crm_` + 8 hex: o bastante para a pessoa reconhecer a chave na tela. */
const TAMANHO_DO_PREFIXO = PREFIXO.length + 8;

/** A chave para a API. Sem `keyHash`, sem valor bruto — mascarada. */
export interface ChaveParaApi {
  id: string;
  nome: string;
  /** `crm_a1b2c3d4••••••••` — o que a interface exibe. */
  mascarada: string;
  escopos: string[];
  criadaEm: Date;
  ultimoUsoEm: Date | null;
  revogadaEm: Date | null;
}

/** Emissão e rotação: o ÚNICO retorno que carrega o valor bruto. */
export interface ChaveEmitida {
  chave: ChaveParaApi;
  /** Existe uma vez. Não é relido de lugar nenhum depois desta resposta. */
  valor: string;
}

/**
 * Chaves de integração do owner — a máquina de segredo-por-registro.
 *
 * Cinco garantias, e cada uma tem um lugar no código:
 *  1. **Geração** — 32 bytes de `randomBytes`, hex, com prefixo reconhecível.
 *  2. **Exibição única** — o valor bruto só existe no retorno de `emitir` e
 *     `rotacionar`; o repositório nunca faz `select` de `keyHash`.
 *  3. **Mascaramento** — `paraApi` é o único caminho para a fronteira HTTP.
 *  4. **Ausência em log e no diff da auditoria** — os logs daqui carregam
 *     `chaveId` e `prefixo`, nunca o valor; `keyHash`/`prefix` estão em
 *     `CAMPOS_OMITIDOS` (`shared/audit-diff.ts`).
 *  5. **Rotação** — troca o segredo da MESMA linha, e a anterior morre na hora.
 *
 * **Recuperar chave perdida não existe, e não é omissão**: o banco guarda hash.
 * Quem perdeu rotaciona.
 */
@Injectable()
export class IntegrationKeysService {
  private readonly logger = new Logger(IntegrationKeysService.name);

  constructor(
    @Inject(INTEGRATION_KEY_REPOSITORY)
    private readonly repo: IntegrationKeyRepository,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string): Promise<ChaveParaApi[]> {
    const chaves = await this.repo.findManyByOwner(ownerId);
    return chaves.map((c) => this.paraApi(c));
  }

  /** Emite uma chave nova. O valor bruto volta UMA vez, aqui. */
  async emitir(params: {
    ownerId: string;
    name: string;
    scopes: string[];
  }): Promise<ChaveEmitida> {
    const escopos = params.scopes.filter(isIntegrationScope);
    const valor = this.gerar();
    const criada = await this.repo.create({
      ownerId: params.ownerId,
      name: params.name.trim(),
      keyHash: this.hash(valor),
      prefix: valor.slice(0, TAMANHO_DO_PREFIXO),
      scopes: escopos,
    });
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: criada.id,
      entityLabel: criada.name,
      action: 'CRIAR',
      extra: { escopos },
    });
    this.logger.log({
      evento: 'integracao.chave_emitida',
      msg: 'Chave de integração emitida.',
      chaveId: criada.id,
      prefixo: criada.prefix,
      escopos,
    });
    return { chave: this.paraApi(criada), valor };
  }

  /**
   * Troca o segredo e devolve o novo, uma vez. A chave anterior deixa de
   * autenticar IMEDIATAMENTE — não há janela de convivência, como no convite
   * de colaborador. Rotacionar uma chave revogada a reativa.
   */
  async rotacionar(ownerId: string, id: string): Promise<ChaveEmitida> {
    const atual = await this.assertDoOwner(ownerId, id);
    const valor = this.gerar();
    const nova = await this.repo.replaceSecret(ownerId, id, {
      keyHash: this.hash(valor),
      prefix: valor.slice(0, TAMANHO_DO_PREFIXO),
    });
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: id,
      entityLabel: atual.name,
      action: 'ROTACIONAR',
    });
    this.logger.warn({
      evento: 'integracao.chave_rotacionada',
      msg: 'Chave de integração rotacionada: a anterior deixou de valer.',
      chaveId: id,
      prefixo: nova.prefix,
    });
    return { chave: this.paraApi(nova), valor };
  }

  /** Revoga sem apagar: a tela precisa dizer que a chave existia e morreu. */
  async revogar(ownerId: string, id: string): Promise<ChaveParaApi> {
    const atual = await this.assertDoOwner(ownerId, id);
    const revogada = await this.repo.revoke(ownerId, id);
    await this.audit.registrar({
      entity: 'INTEGRATION',
      entityId: id,
      entityLabel: atual.name,
      action: 'EXCLUIR',
    });
    this.logger.warn({
      evento: 'integracao.chave_revogada',
      msg: 'Chave de integração revogada.',
      chaveId: id,
      prefixo: revogada.prefix,
    });
    return this.paraApi(revogada);
  }

  /** Apaga a linha. Usado quando o registro que ela credencia deixa de existir. */
  async apagar(ownerId: string, id: string): Promise<void> {
    await this.repo.delete(ownerId, id);
  }

  /**
   * Autentica o valor apresentado no header e exige o escopo.
   *
   * Sem `timingSafeEqual`: a comparação não é feita em código, é um
   * `findUnique` pelo sha256 — não existe segredo local com que comparar byte
   * a byte, e o índice não vaza o valor.
   */
  async autenticar(
    valor: string,
    escopo: string,
  ): Promise<{ ownerId: string; keyId: string; keyName: string }> {
    const chave = await this.repo.findByHashPeloSistema(this.hash(valor));
    if (!chave || chave.revokedAt) {
      // Nunca logar o valor recebido: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'integracao.chave_recusada',
        msg: 'Chave de integração inexistente ou revogada.',
      });
      throw new UnauthorizedException('Chave de integração inválida.');
    }
    if (!chave.scopes.includes(escopo)) {
      this.logger.warn({
        evento: 'integracao.escopo_insuficiente',
        msg: 'Chave de integração sem o escopo exigido pela rota.',
        chaveId: chave.id,
        escopoExigido: escopo,
      });
      throw new ForbiddenException(
        'Esta chave de integração não tem permissão para esta operação.',
      );
    }
    // `keyName` sai daqui porque é ele que vira `actorName` na trilha de
    // auditoria da API pública: escrita por máquina precisa nomear a credencial.
    return { ownerId: chave.ownerId, keyId: chave.id, keyName: chave.name };
  }

  /** Marca o último uso. Chamado DENTRO do contexto de owner de quem usou. */
  registrarUso(ownerId: string, keyId: string): Promise<void> {
    return this.repo.touch(ownerId, keyId);
  }

  private async assertDoOwner(
    ownerId: string,
    id: string,
  ): Promise<IntegrationKeyRecord> {
    const chave = await this.repo.findById(ownerId, id);
    if (!chave)
      throw new NotFoundException('Chave de integração não encontrada.');
    return chave;
  }

  /** 32 bytes: mesma entropia do token de convite (`invites.service.ts:67`). */
  private gerar(): string {
    return `${PREFIXO}${randomBytes(32).toString('hex')}`;
  }

  /** Hash determinístico: permite busca indexada pelo valor apresentado. */
  private hash(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  /** A única saída para a fronteira HTTP. Mascara, nunca revela. */
  private paraApi(c: IntegrationKeyRecord): ChaveParaApi {
    return {
      id: c.id,
      nome: c.name,
      mascarada: `${c.prefix}${'•'.repeat(8)}`,
      escopos: c.scopes,
      criadaEm: c.createdAt,
      ultimoUsoEm: c.lastUsedAt,
      revogadaEm: c.revokedAt,
    };
  }
}
