import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OwnerWebhook } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { postar } from '../../../shared/webhook-post';
import { gerarSegredoDeWebhook } from '../../../shared/webhook-signature';
import { validarUrlDeWebhook } from '../../../shared/webhook-url';
import {
  OWNER_WEBHOOK_REPOSITORY,
  type OwnerWebhookRepository,
} from '../domain/owner-webhook.repository';
import type { CreateOwnerWebhookDto } from '../api/dto/create-owner-webhook.dto';
import type { UpdateOwnerWebhookDto } from '../api/dto/update-owner-webhook.dto';

/**
 * O webhook como a API o devolve. **Nunca** traz `secret`, e da URL traz só o
 * `host` — mesma regra de `resumirConfig` do destino de notificação: o caminho
 * completo é credencial (quem o tiver escreve no endpoint).
 */
export interface WebhookNaApi {
  id: string;
  nome: string;
  /** Só o host (`n8n.minhaempresa.com`), nunca o caminho. */
  host: string | null;
  eventos: string[];
  ativo: boolean;
  verificadoEm: Date | null;
  ultimoUsoEm: Date | null;
  criadoEm: Date;
}

/** Criação e rotação: o ÚNICO retorno que carrega o segredo bruto. */
export interface WebhookComSegredo {
  webhook: WebhookNaApi;
  /** Existe uma vez. Não é relido de lugar nenhum depois desta resposta. */
  segredo: string;
}

@Injectable()
export class OwnerWebhooksService {
  private readonly logger = new Logger(OwnerWebhooksService.name);

  constructor(
    @Inject(OWNER_WEBHOOK_REPOSITORY)
    private readonly repo: OwnerWebhookRepository,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string): Promise<WebhookNaApi[]> {
    const webhooks = await this.repo.findManyByOwner(ownerId);
    return webhooks.map(paraApi);
  }

  /**
   * Cadastra o webhook. Nasce **inativo e não verificado**: nenhum evento sai
   * antes do ping de `verificar`, como o destino de integração da Fase 9.
   */
  async criar(
    ownerId: string,
    dto: CreateOwnerWebhookDto,
  ): Promise<WebhookComSegredo> {
    // A trava que importa: HTTPS, porta padrão e nada de rede interna (SSRF).
    await validarUrlDeWebhook(dto.url);
    const segredo = gerarSegredoDeWebhook();
    const criado = await this.criarOuConflitar(() =>
      this.repo.create({
        ownerId,
        name: dto.nome.trim(),
        url: dto.url,
        secret: segredo,
        events: dto.eventos,
      }),
    );
    await this.audit.registrar({
      entity: 'WEBHOOK',
      entityId: criado.id,
      entityLabel: criado.name,
      action: 'CRIAR',
      extra: { eventos: dto.eventos, host: hostDe(criado.url) },
    });
    this.logger.log({
      evento: 'webhook.cadastrado',
      msg: 'Webhook de saída cadastrado.',
      webhookId: criado.id,
      // Só o host: o caminho é credencial e a linha vive 30 dias num Grafana
      // publicado.
      host: hostDe(criado.url),
      eventos: dto.eventos,
    });
    return { webhook: paraApi(criado), segredo };
  }

  /**
   * Altera nome, URL e eventos. **Trocar a URL derruba a verificação**: o CRM não
   * sabe se o endereço novo responde, e manter `active` faria as entregas irem
   * para um destino nunca testado.
   */
  async atualizar(
    ownerId: string,
    id: string,
    dto: UpdateOwnerWebhookDto,
  ): Promise<WebhookNaApi> {
    const atual = await this.assertDoOwner(ownerId, id);
    if (dto.url !== undefined && dto.url !== atual.url) {
      await validarUrlDeWebhook(dto.url);
    }
    const trocouUrl = dto.url !== undefined && dto.url !== atual.url;
    const atualizado = await this.criarOuConflitar(() =>
      this.repo.update(ownerId, id, {
        ...(dto.nome !== undefined ? { name: dto.nome.trim() } : {}),
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.eventos !== undefined ? { events: dto.eventos } : {}),
        ...(dto.ativo !== undefined ? { active: dto.ativo } : {}),
        ...(trocouUrl ? { verifiedAt: null, active: false } : {}),
      }),
    );
    if (!atualizado) throw new NotFoundException('Webhook não encontrado.');
    await this.audit.registrar({
      entity: 'WEBHOOK',
      entityId: id,
      entityLabel: atualizado.name,
      action: 'ATUALIZAR',
      antes: {
        name: atual.name,
        events: atual.events,
        active: atual.active,
        host: hostDe(atual.url),
      },
      depois: {
        name: atualizado.name,
        events: atualizado.events,
        active: atualizado.active,
        host: hostDe(atualizado.url),
      },
    });
    return paraApi(atualizado);
  }

  /**
   * Manda um ping ao endereço e só então marca como verificado e ativo. É o que
   * impede cadastrar uma URL que o CRM nunca alcançou — e o ping **já vai
   * assinado**, para quem está do outro lado poder conferir a verificação antes
   * de valer para evento real.
   */
  async verificar(ownerId: string, id: string): Promise<WebhookNaApi> {
    const alvo = await this.assertDoOwner(ownerId, id);
    try {
      await postar(
        alvo.url,
        {
          evento: 'webhook.teste',
          dados: {
            mensagem:
              'Se você recebeu esta mensagem, o webhook está funcionando.',
          },
          ocorridoEm: new Date().toISOString(),
        },
        // Não há entrega real por trás de um ping — o id do webhook serve de
        // referência para quem estiver depurando do outro lado.
        alvo.id,
        alvo.secret,
      );
    } catch (erro) {
      // A URL nunca entra na mensagem: ela é a credencial.
      throw new UnprocessableEntityException(
        `Não foi possível entregar no endereço: ${
          erro instanceof Error ? erro.message : 'falha desconhecida'
        }`,
      );
    }
    const atualizado = await this.repo.update(ownerId, id, {
      verifiedAt: new Date(),
      active: true,
    });
    if (!atualizado) throw new NotFoundException('Webhook não encontrado.');
    this.logger.log({
      evento: 'webhook.verificado',
      msg: 'Webhook de saída verificado e ativado.',
      webhookId: id,
      host: hostDe(atualizado.url),
    });
    return paraApi(atualizado);
  }

  /**
   * Troca o segredo e devolve o novo, uma vez. A assinatura anterior deixa de
   * casar IMEDIATAMENTE — mesma decisão da chave de integração: manter duas
   * assinaturas válidas exigiria enviar as duas no cabeçalho e o receptor
   * aceitar qualquer uma, o que enfraquece a rotação em vez de facilitá-la.
   */
  async rotacionarSegredo(
    ownerId: string,
    id: string,
  ): Promise<WebhookComSegredo> {
    const atual = await this.assertDoOwner(ownerId, id);
    const segredo = gerarSegredoDeWebhook();
    const atualizado = await this.repo.replaceSecret(ownerId, id, segredo);
    if (!atualizado) throw new NotFoundException('Webhook não encontrado.');
    await this.audit.registrar({
      entity: 'WEBHOOK',
      entityId: id,
      entityLabel: atual.name,
      action: 'ROTACIONAR',
    });
    this.logger.warn({
      evento: 'webhook.rotacionado',
      msg: 'Segredo de webhook rotacionado: a assinatura anterior deixou de casar.',
      webhookId: id,
      host: hostDe(atualizado.url),
    });
    return { webhook: paraApi(atualizado), segredo };
  }

  /** Exclui. As entregas pendentes vão junto (FK em cascata). */
  async excluir(ownerId: string, id: string): Promise<void> {
    const atual = await this.assertDoOwner(ownerId, id);
    await this.repo.delete(ownerId, id);
    await this.audit.registrar({
      entity: 'WEBHOOK',
      entityId: id,
      entityLabel: atual.name,
      action: 'EXCLUIR',
    });
    this.logger.warn({
      evento: 'webhook.excluido',
      msg: 'Webhook de saída excluído.',
      webhookId: id,
      host: hostDe(atual.url),
    });
  }

  private async assertDoOwner(
    ownerId: string,
    id: string,
  ): Promise<OwnerWebhook> {
    const webhook = await this.repo.findById(ownerId, id);
    // 404 (não 403): webhook de outro owner não deve nem revelar que existe.
    if (!webhook) throw new NotFoundException('Webhook não encontrado.');
    return webhook;
  }

  /**
   * Traduz a violação do `@@unique([ownerId, name])` numa mensagem de campo. Sem
   * isto, nome repetido responde 500 — e o nome é o que a pessoa reconhece na
   * tela, então repetir é um erro fácil de cometer.
   */
  private async criarOuConflitar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (erro) {
      if ((erro as { code?: string }).code === 'P2002') {
        throw new ConflictException('Já existe um webhook com este nome.');
      }
      throw erro;
    }
  }
}

/** O único caminho para a fronteira HTTP. Esconde o segredo e o caminho da URL. */
export function paraApi(w: OwnerWebhook): WebhookNaApi {
  return {
    id: w.id,
    nome: w.name,
    host: hostDe(w.url),
    eventos: w.events,
    ativo: w.active,
    verificadoEm: w.verifiedAt,
    ultimoUsoEm: w.lastUsedAt,
    criadoEm: w.createdAt,
  };
}

/** Só o host da URL. O caminho é credencial e não sai da API nem do log. */
function hostDe(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    // URL inválida guardada no banco: não devolve nada em vez de vazar a string.
    return null;
  }
}
