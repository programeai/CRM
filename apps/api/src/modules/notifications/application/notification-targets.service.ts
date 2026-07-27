import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  NotificationChannelKind,
  NotificationType,
  UserNotificationTarget,
} from '@prisma/client';
import {
  NOTIFICATION_TARGET_REPOSITORY,
  TIPOS_PADRAO,
  type NotificationTargetRepository,
} from '../domain/notification-target.repository';
import {
  NOTIFICATION_CHANNELS,
  type CanalDeNotificacao,
} from '../domain/notification-channel';
import { validarUrlDeWebhook } from './webhook-url';
import type { CreateNotificationTargetDto } from '../api/dto/create-notification-target.dto';
import type { CreateWebhookTargetDto } from '../api/dto/create-webhook-target.dto';
import type { UpdateNotificationTargetDto } from '../api/dto/update-notification-target.dto';

/**
 * O destino como a API o devolve. **A `config` nunca volta crua**: `configResumo`
 * é um resumo por kind, porque a URL de um webhook do Slack É a credencial de
 * escrita naquele canal (regra de `apps/api/CLAUDE.md:51` aplicada a um campo
 * `Json` que carrega segredo).
 */
export interface DestinoNaApi {
  id: string;
  kind: NotificationChannelKind;
  label: string;
  /** `null` no IN_APP, o endereço no EMAIL, só o **host** no WEBHOOK/SLACK. */
  configResumo: string | null;
  types: NotificationType[];
  verified: boolean;
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class NotificationTargetsService {
  constructor(
    @Inject(NOTIFICATION_TARGET_REPOSITORY)
    private readonly repo: NotificationTargetRepository,
    @Inject(NOTIFICATION_CHANNELS)
    private readonly canais: CanalDeNotificacao[],
  ) {}

  async list(ownerId: string, userId: string): Promise<DestinoNaApi[]> {
    const destinos = await this.repo.findManyByUser(ownerId, userId);
    return destinos.map(paraApi);
  }

  /** Cria um destino de e-mail. Nasce verificado: o endereço é do próprio usuário. */
  async criarEmail(
    ownerId: string,
    userId: string,
    dto: CreateNotificationTargetDto,
  ): Promise<DestinoNaApi> {
    const criado = await this.repo.criar({
      ownerId,
      userId,
      kind: 'EMAIL',
      label: dto.label,
      config: { email: dto.email },
      types: dto.types ?? TIPOS_PADRAO,
      verified: true,
      active: true,
    });
    return paraApi(criado);
  }

  /**
   * Cria um destino de integração (`WEBHOOK`/`SLACK`). Nasce **`verified: false` e
   * `active: false`** (D4): nenhuma entrega sai antes do ping de verificação —
   * `findElegiveis` filtra por `verified: true` desde a Fase 1.
   */
  async criarIntegracao(
    ownerId: string,
    userId: string,
    dto: CreateWebhookTargetDto,
  ): Promise<DestinoNaApi> {
    // A trava que importa: HTTPS, porta padrão e nada de rede interna (SSRF).
    await validarUrlDeWebhook(dto.url);
    const criado = await this.repo.criar({
      ownerId,
      userId,
      kind: dto.kind,
      label: dto.label,
      config: { url: dto.url },
      types: dto.types ?? TIPOS_PADRAO,
      verified: false,
      active: false,
    });
    return paraApi(criado);
  }

  /**
   * Envia um ping ao destino e só então o marca como verificado e ativo. É o que
   * impede cadastrar uma URL que o CRM nunca conseguiu alcançar — e, junto da
   * permissão, o que fecha a superfície de exfiltração de **D4**.
   */
  async verificar(
    ownerId: string,
    userId: string,
    id: string,
  ): Promise<DestinoNaApi> {
    const destinos = await this.repo.findManyByUser(ownerId, userId);
    const alvo = destinos.find((d) => d.id === id);
    if (!alvo) throw new NotFoundException('Destino não encontrado.');
    if (alvo.kind === 'IN_APP' || alvo.kind === 'EMAIL') {
      throw new UnprocessableEntityException(
        'Este destino não precisa de verificação.',
      );
    }

    const canal = this.canais.find((c) => c.kind === alvo.kind);
    if (!canal) {
      throw new UnprocessableEntityException(
        'Este tipo de integração não está disponível nesta instalação.',
      );
    }

    try {
      await canal.entregar(
        { id: alvo.id, kind: alvo.kind, config: alvo.config },
        {
          tipo: 'RECORD_ASSIGNED',
          titulo: 'Teste de integração',
          corpo:
            'Se você recebeu esta mensagem, a integração está funcionando.',
          link: null,
          dados: null,
          // Não há entrega real por trás de um ping — o id do destino serve de
          // referência para quem estiver depurando do outro lado.
          deliveryId: alvo.id,
        },
      );
    } catch (erro) {
      // A URL nunca entra na mensagem: ela é a credencial.
      throw new UnprocessableEntityException(
        `Não foi possível entregar no destino: ${
          erro instanceof Error ? erro.message : 'falha desconhecida'
        }`,
      );
    }

    const atualizado = await this.repo.atualizar(ownerId, userId, id, {
      verified: true,
      active: true,
    });
    if (!atualizado) throw new NotFoundException('Destino não encontrado.');
    return paraApi(atualizado);
  }

  async atualizar(
    ownerId: string,
    userId: string,
    id: string,
    dto: UpdateNotificationTargetDto,
  ): Promise<DestinoNaApi> {
    const atualizado = await this.repo.atualizar(ownerId, userId, id, {
      ...(dto.label !== undefined ? { label: dto.label } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
      ...(dto.types !== undefined ? { types: dto.types } : {}),
    });
    // 404 (não 403): destino de outra pessoa não deve nem revelar que existe.
    if (!atualizado) throw new NotFoundException('Destino não encontrado.');
    return paraApi(atualizado);
  }

  async excluir(ownerId: string, userId: string, id: string): Promise<void> {
    const destinos = await this.repo.findManyByUser(ownerId, userId);
    const alvo = destinos.find((d) => d.id === id);
    if (!alvo) throw new NotFoundException('Destino não encontrado.');
    // Apagar o último IN_APP deixaria o sino permanentemente vazio sem explicação
    // — desativar é reversível, apagar não.
    if (
      alvo.kind === 'IN_APP' &&
      destinos.filter((d) => d.kind === 'IN_APP').length === 1
    ) {
      throw new UnprocessableEntityException(
        'Não é possível remover a central de notificações. Desative-a, se preferir não receber.',
      );
    }
    await this.repo.excluir(ownerId, userId, id);
  }
}

/** Serializa o destino escondendo a `config`. Ver o comentário de `DestinoNaApi`. */
export function paraApi(destino: UserNotificationTarget): DestinoNaApi {
  return {
    id: destino.id,
    kind: destino.kind,
    label: destino.label,
    configResumo: resumirConfig(destino.kind, destino.config),
    types: destino.types,
    verified: destino.verified,
    active: destino.active,
    createdAt: destino.createdAt,
  };
}

/**
 * Resumo exibível da `config`, por kind:
 *  - `IN_APP` → `null` (não há o que mostrar);
 *  - `EMAIL` → o endereço (é do próprio usuário, e ele precisa conferir qual é);
 *  - `WEBHOOK`/`SLACK` → **só o host** (`hooks.slack.com`), nunca o caminho, que
 *    é a credencial.
 */
function resumirConfig(
  kind: NotificationChannelKind,
  config: unknown,
): string | null {
  if (kind === 'IN_APP') return null;
  if (kind === 'EMAIL') {
    return (config as { email?: string })?.email ?? null;
  }
  const url = (config as { url?: string })?.url;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    // URL inválida guardada no banco: não devolve nada em vez de vazar a string.
    return null;
  }
}
