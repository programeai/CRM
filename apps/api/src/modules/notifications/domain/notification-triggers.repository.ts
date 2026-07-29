export const NOTIFICATION_TRIGGERS_REPOSITORY = Symbol(
  'NOTIFICATION_TRIGGERS_REPOSITORY',
);

/**
 * Uma linha a notificar, com o destinatário JÁ DERIVADO (D2). A derivação vive no
 * repositório porque ela é um join — `Proposal → Deal|Client → assigneeId`,
 * `Payment → Contract → Client → assigneeId` — e resolvê-la no service
 * significaria N+1 consultas num cron cross-owner.
 */
export interface AlvoDeLembrete {
  ownerId: string;
  /** Destinatário derivado; nunca nulo (o fallback final é o owner). */
  userId: string;
  entityId: string;
  /** Rótulo humano do registro ("PROP-2026-0042", "Mensalidade 08/2026"). */
  label: string;
  clienteNome: string;
  /** A data que motivou o lembrete — compõe o `dedupeKey`. */
  dataAlvo: Date;
  /** Só em PAYMENT_DUE. */
  valor?: number;
  /** Só em FOLLOW_UP_DUE: a timeline mora sob o cliente, e o link precisa dele. */
  clientId?: string;
  /** Só em DEAL_STALE: o estágio em que a oportunidade empacou. */
  estagio?: string;
}

export interface NotificationTriggersRepository {
  /** (a) Follow-up: tipo com `isFollowUp` no catálogo do owner, não concluído, `scheduledFor` HOJE. */
  followUpsDoDia(de: Date, ate: Date): Promise<AlvoDeLembrete[]>;
  /** (b) `status IN (SENT, NEGOTIATING)`, `validUntil` em (agora, agora+Nd]. */
  propostasAExpirar(de: Date, ate: Date): Promise<AlvoDeLembrete[]>;
  /** (c) `status=PENDING`, `dueDate` em (agora, agora+Nd]. */
  cobrancasAVencer(de: Date, ate: Date): Promise<AlvoDeLembrete[]>;
  /** (e) `status != DONE`, `dueDate < agora`, **`archivedAt IS NULL`**. */
  demandasAtrasadas(agora: Date): Promise<AlvoDeLembrete[]>;
  /**
   * (f) `stageMovedAt < limite`, estágio **não terminal**, `archivedAt IS NULL`.
   * O `dataAlvo` é o `stageMovedAt` — e é ele que faz o aviso sair uma vez por
   * permanência, não um por dia: enquanto a oportunidade não se move, a chave de
   * dedupe não muda.
   */
  oportunidadesEsfriando(limite: Date): Promise<AlvoDeLembrete[]>;
}
