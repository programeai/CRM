import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { NotificationType } from '@prisma/client';
import {
  NOTIFICATION_TRIGGERS_REPOSITORY,
  type AlvoDeLembrete,
  type NotificationTriggersRepository,
} from '../domain/notification-triggers.repository';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';
import { NotificationsService } from '../notifications.service';
import { OwnerWebhooksEmitterService } from '../../webhooks/application/owner-webhooks-emitter.service';
import { EVENTO_POR_TIPO } from '../../webhooks/domain/owner-webhook-event';
import type { EventoDeNotificacao } from './notification-content';

/**
 * Antecedência dos gatilhos de prazo. Constantes de código nesta fase — janelas
 * configuráveis por owner ficam para depois (acrescentariam um quarto modelo e
 * uma tela a uma fase que já é larga).
 */
const DIAS_PROPOSTA = 3;
const DIAS_COBRANCA = 3;
/**
 * Dias parados no mesmo estágio até a oportunidade contar como esfriando.
 * **Espelha `COOLING_DAYS` de `apps/web/src/features/pipeline/lib/deal-format.ts`**:
 * o selo no card e este aviso têm de concordar, senão a pessoa recebe e-mail de
 * um card que não está marcado (ou o contrário). Mudar um exige mudar o outro.
 */
const DIAS_ESFRIANDO = 7;

/** Começo do dia local (00:00:00.000). */
function inicioDoDia(agora: Date): Date {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fim do dia local (23:59:59.999). */
function fimDoDia(agora: Date): Date {
  const d = new Date(agora);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** `agora + n` dias. */
function maisDias(agora: Date, n: number): Date {
  const d = new Date(agora);
  d.setDate(d.getDate() + n);
  return d;
}

/** `agora - n` dias. */
function menosDias(agora: Date, n: number): Date {
  return maisDias(agora, -n);
}

@Injectable()
export class NotificationsRemindersJob {
  private readonly logger = new Logger(NotificationsRemindersJob.name);

  constructor(
    @Inject(NOTIFICATION_TRIGGERS_REPOSITORY)
    private readonly triggers: NotificationTriggersRepository,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: NotificationRepository,
    private readonly notifications: NotificationsService,
    private readonly webhooks: OwnerWebhooksEmitterService,
  ) {}

  /**
   * Gatilhos (a), (b), (c), (e) e (f). Roda às 6h BRT, uma hora antes do digest,
   * para que o resumo do dia já inclua o que este job emitiu.
   *
   * `name:` e `timeZone:` explícitos — hoje em todos os crons do projeto. Os
   * legados rodavam sem os dois (`EVERY_DAY_AT_3AM` = 3h UTC = meia-noite BRT,
   * três horas antes do que o nome anuncia); a dívida foi paga junto do gatilho
   * (f), e nada novo nasce com ela.
   */
  @Cron('0 6 * * *', {
    name: 'notificacoes-lembretes',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> {
    const agora = new Date();
    const emitidas =
      (await this.emitir(
        'FOLLOW_UP_DUE',
        await this.triggers.followUpsDoDia(inicioDoDia(agora), fimDoDia(agora)),
      )) +
      (await this.emitir(
        'PROPOSAL_EXPIRING',
        await this.triggers.propostasAExpirar(
          agora,
          maisDias(agora, DIAS_PROPOSTA),
        ),
      )) +
      (await this.emitir(
        'PAYMENT_DUE',
        await this.triggers.cobrancasAVencer(
          agora,
          maisDias(agora, DIAS_COBRANCA),
        ),
      )) +
      (await this.emitir(
        'TASK_OVERDUE',
        await this.triggers.demandasAtrasadas(agora),
      )) +
      (await this.emitir(
        'DEAL_STALE',
        await this.triggers.oportunidadesEsfriando(
          menosDias(agora, DIAS_ESFRIANDO),
        ),
      ));

    if (emitidas > 0) {
      this.logger.log({
        evento: 'notificacoes.lembretes_emitidos',
        msg: 'Lembretes de prazo emitidos pela rotina diária.',
        quantidade: emitidas,
      });
    }
  }

  /**
   * Pré-filtra pelo `dedupeKey` e emite o que sobrou. Sem isso, um cron diário
   * notificaria a MESMA cobrança todo dia até ela vencer — a chave carrega a
   * data-alvo, então cada item avisa uma vez só. O unique do banco
   * (`Notification_userId_dedupeKey_key`) é o backstop da corrida, não o mecanismo:
   * uma insert que falha dentro de um lote é mais cara que um SELECT antes dele.
   *
   * `try/catch` POR ITEM é obrigatório: nenhum dos dois jobs existentes tem
   * try/catch, e uma falha no meio do `for` mataria o resto do lote.
   */
  private async emitir(
    tipo: NotificationType,
    alvos: AlvoDeLembrete[],
  ): Promise<number> {
    if (alvos.length === 0) return 0;

    // O dedupe é por (userId, dedupeKey): o pré-filtro agrupa por destinatário,
    // porque a mesma chave pode existir para uma pessoa e não para outra.
    const chavePorAlvo = new Map<AlvoDeLembrete, string>(
      alvos.map((a) => [a, this.dedupeKey(tipo, a)]),
    );
    const porUsuario = new Map<string, AlvoDeLembrete[]>();
    for (const alvo of alvos) {
      const lista = porUsuario.get(alvo.userId) ?? [];
      lista.push(alvo);
      porUsuario.set(alvo.userId, lista);
    }

    let emitidas = 0;
    for (const [userId, doUsuario] of porUsuario) {
      const existentes = await this.repo.dedupeKeysExistentes(
        userId,
        doUsuario.map((a) => chavePorAlvo.get(a)!),
      );
      for (const alvo of doUsuario) {
        const dedupeKey = chavePorAlvo.get(alvo)!;
        if (existentes.has(dedupeKey)) continue;
        try {
          await this.notifications.notificarPeloSistema({
            ownerId: alvo.ownerId,
            userId: alvo.userId,
            dedupeKey,
            evento: this.evento(tipo, alvo),
          });
          /*
            Gêmeo do aviso interno, para FORA da workspace. Fica DENTRO do
            `if (existentes.has(dedupeKey)) continue` acima, de propósito: o
            dedupe da notificação também governa o webhook, senão um
            reprocessamento manual mandaria o evento de novo para o sistema de
            terceiro — que é justamente onde repetição custa.
          */
          await this.webhooks.emitirPeloSistema({
            ownerId: alvo.ownerId,
            evento: EVENTO_POR_TIPO[tipo],
            entityId: alvo.entityId,
            dados: {
              titulo: alvo.label,
              clienteNome: alvo.clienteNome,
              dataAlvo: alvo.dataAlvo.toISOString(),
              ...(alvo.valor !== undefined ? { valor: alvo.valor } : {}),
              ...(alvo.estagio !== undefined ? { estagio: alvo.estagio } : {}),
            },
          });
          emitidas++;
        } catch (erro) {
          // `notificarPeloSistema` já engole a própria exceção; este catch cobre
          // o que vier de fora dela (montagem do evento) e garante que uma linha
          // ruim não mate o resto do lote.
          this.logger.error({
            evento: 'notificacao.emissao_falhou',
            msg: 'Falha ao emitir lembrete de prazo.',
            tipo,
            entidadeId: alvo.entityId,
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        }
      }
    }
    return emitidas;
  }

  /** `PAYMENT_DUE:<id>:2026-08-01` — a data-alvo é o que faz avisar uma vez só. */
  private dedupeKey(tipo: NotificationType, alvo: AlvoDeLembrete): string {
    return `${tipo}:${alvo.entityId}:${alvo.dataAlvo.toISOString().slice(0, 10)}`;
  }

  /** Alvo do read model → evento de domínio do tipo correspondente. */
  private evento(
    tipo: NotificationType,
    alvo: AlvoDeLembrete,
  ): EventoDeNotificacao {
    switch (tipo) {
      case 'FOLLOW_UP_DUE':
        return {
          tipo: 'FOLLOW_UP_DUE',
          entityId: alvo.entityId,
          descricao: alvo.label,
          clienteNome: alvo.clienteNome,
          clientId: alvo.clientId!,
          dataAlvo: alvo.dataAlvo,
        };
      case 'PROPOSAL_EXPIRING':
        return {
          tipo: 'PROPOSAL_EXPIRING',
          entityId: alvo.entityId,
          numero: alvo.label,
          clienteNome: alvo.clienteNome,
          dataAlvo: alvo.dataAlvo,
        };
      case 'PAYMENT_DUE':
        return {
          tipo: 'PAYMENT_DUE',
          entityId: alvo.entityId,
          descricao: alvo.label,
          clienteNome: alvo.clienteNome,
          valor: alvo.valor ?? 0,
          dataAlvo: alvo.dataAlvo,
        };
      case 'TASK_OVERDUE':
        return {
          tipo: 'TASK_OVERDUE',
          entityId: alvo.entityId,
          titulo: alvo.label,
          clienteNome: alvo.clienteNome,
          dataAlvo: alvo.dataAlvo,
        };
      case 'DEAL_STALE':
        return {
          tipo: 'DEAL_STALE',
          entityId: alvo.entityId,
          titulo: alvo.label,
          clienteNome: alvo.clienteNome,
          estagio: alvo.estagio!,
          dataAlvo: alvo.dataAlvo,
        };
      default:
        // Os outros tipos (`PAYMENT_OVERDUE`, `RECORD_ASSIGNED`) não passam por
        // este job — quem os emite é o `FinanceBillingJob` e o caminho do request.
        throw new Error(`Tipo sem lembrete de prazo: ${tipo}`);
    }
  }
}
