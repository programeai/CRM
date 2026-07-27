import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { NotificationChannelKind, Prisma } from '@prisma/client';
import {
  ACCESS_CONTEXT,
  type AccessContext,
} from '../access/domain/access-context';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from './domain/notification.repository';
import {
  NOTIFICATION_TARGET_REPOSITORY,
  type NotificationTargetRepository,
} from './domain/notification-target.repository';
import {
  montarConteudo,
  type ContextoDeEmissao,
  type EventoDeNotificacao,
} from './application/notification-content';

/** Emissão no caminho de requisição HTTP. */
export interface EntradaDeNotificacao {
  /** Destinatário. É `User.id`, NÃO `ownerId` — é a única entidade do sistema
   *  endereçada por pessoa, e é por isso que o gatilho precisa derivá-lo. */
  userId: string;
  evento: EventoDeNotificacao;
}

/** Emissão fora do request (cron): `ownerId` explícito e dedupe. */
export interface EntradaDeSistema extends EntradaDeNotificacao {
  ownerId: string;
  /** Idempotência do gatilho recorrente. Ver `NotificationsRemindersJob`. */
  dedupeKey?: string;
}

/**
 * Emissão de notificação. Mesmo desenho de duas superfícies do `AuditService`:
 * `notificar` roda por `prisma.db` (dentro da transação do request) e
 * `notificarPeloSistema` pelo client admin (cron cross-owner, sem `app.owner_id`).
 *
 * **DIVERGÊNCIA DELIBERADA em relação ao AuditService — não "conserte" para ficar
 * igual.** A auditoria deixa a exceção subir no caminho humano de propósito: se a
 * trilha não pode ser gravada, a mudança não deve ser aplicada. Aqui é o oposto —
 * uma notificação que falha **não pode** derrubar a operação de negócio que a
 * disparou. Os DOIS métodos engolem a exceção e logam.
 *
 * O que roda dentro da transação é só banco: um SELECT nos destinos (tabela
 * pequena e indexada) e um create aninhado. **Zero I/O de rede** — a transação
 * do request usa o timeout default do Prisma (5s), e a entrega de verdade
 * acontece depois do commit, varrida pelo `NotificationsDispatchJob`.
 *
 * `notificar` carrega DUAS regras que valem para qualquer gatilho do caminho
 * humano, e é por isso que elas moram aqui e não em cada ponto de emissão:
 *  1. **Ninguém é notificado da própria ação.** Quem acabou de atribuir o
 *     registro a si mesmo não precisa de aviso — estava olhando a tela.
 *  2. **O autor vem do CLS**, não do gatilho. `AccessContext.userName` já está
 *     resolvido; fazer cada service lê-lo seria injetar `ClsService` em quatro
 *     módulos de negócio para repetir a mesma linha.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: NotificationRepository,
    @Inject(NOTIFICATION_TARGET_REPOSITORY)
    private readonly targets: NotificationTargetRepository,
    private readonly cls: ClsService,
  ) {}

  async notificar(entrada: EntradaDeNotificacao): Promise<void> {
    const access = this.cls.get<AccessContext>(ACCESS_CONTEXT);
    if (!access) {
      this.logger.warn({
        evento: 'notificacao.sem_contexto',
        msg: 'Tentativa de notificar sem contexto de acesso.',
        tipo: entrada.evento.tipo,
      });
      return;
    }
    // Regra 1. Antes de qualquer ida ao banco: o caso mais comum de um gatilho
    // de request é a pessoa agindo sobre o próprio registro.
    if (entrada.userId === access.userId) return;
    try {
      const destinos = await this.targets.findElegiveis(
        access.ownerId,
        entrada.userId,
        entrada.evento.tipo,
      );
      if (destinos.length === 0) return;
      await this.repo.criar(
        this.montarLinha(
          access.ownerId,
          entrada.userId,
          entrada.evento,
          destinos,
          null,
          {
            autorNome: access.userName, // regra 2
          },
        ),
      );
    } catch (erro) {
      this.falhou(entrada.evento.tipo, erro);
    }
  }

  async notificarPeloSistema(entrada: EntradaDeSistema): Promise<void> {
    try {
      const destinos = await this.targets.findElegiveisPeloSistema(
        entrada.ownerId,
        entrada.userId,
        entrada.evento.tipo,
      );
      if (destinos.length === 0) return;
      await this.repo.criarPeloSistema(
        this.montarLinha(
          entrada.ownerId,
          entrada.userId,
          entrada.evento,
          destinos,
          entrada.dedupeKey ?? null,
          // Fora do request não há ator humano — é a razão de `autorNome` ser
          // anulável e de o conteúdo ter a variante impessoal.
          { autorNome: null },
        ),
      );
    } catch (erro) {
      // P2002 = corrida no dedupe (o pré-filtro do job já cobre o caso normal).
      // Notificação repetida evitada não é erro; qualquer outra falha é.
      if ((erro as { code?: string }).code === 'P2002') return;
      this.falhou(entrada.evento.tipo, erro);
    }
  }

  /** A notificação e as N entregas num único create aninhado (uma ida ao banco). */
  private montarLinha(
    ownerId: string,
    userId: string,
    evento: EventoDeNotificacao,
    destinos: { id: string; kind: NotificationChannelKind }[],
    dedupeKey: string | null,
    contexto: ContextoDeEmissao,
  ): Prisma.NotificationUncheckedCreateInput {
    const conteudo = montarConteudo(evento, contexto);
    return {
      ownerId,
      userId,
      type: conteudo.tipo,
      entity: conteudo.entity,
      entityId: conteudo.entityId,
      title: conteudo.title,
      body: conteudo.body,
      link: conteudo.link,
      data: (conteudo.data ?? undefined) as Prisma.InputJsonValue | undefined,
      dedupeKey,
      deliveries: {
        create: destinos.map((d) => ({
          ownerId,
          userId,
          targetId: d.id,
          kind: d.kind,
        })),
      },
    };
  }

  /** Nunca loga título/corpo: eles carregam nome de cliente e valor de cobrança,
   *  e o Grafana é publicado na internet (docs/observabilidade.md:149-152). */
  private falhou(tipo: string, erro: unknown): void {
    this.logger.error(
      {
        evento: 'notificacao.emissao_falhou',
        msg: 'Falha ao emitir notificação.',
        tipo,
      },
      erro instanceof Error ? erro.stack : undefined,
    );
  }
}
