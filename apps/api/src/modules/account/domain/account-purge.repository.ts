export const ACCOUNT_PURGE_REPOSITORY = 'ACCOUNT_PURGE_REPOSITORY';

/** Quantas linhas cada tabela perdeu — vira o `extra` da trilha do expurgo. */
export type LinhasApagadas = Record<string, number>;

export interface OwnerVencido {
  id: string;
  deletionRequestedAt: Date;
}

export interface AccountPurgeRepository {
  /** Owners cuja carência venceu. Roda pelo client admin (cron, cross-owner). */
  vencidos(agora: Date): Promise<OwnerVencido[]>;
  /**
   * Owners que já pediram o encerramento e cuja assinatura ainda pode renovar —
   * a lista da varredura que marca `cancel_at_period_end` no Stripe.
   */
  pendentesDeCancelamento(): Promise<string[]>;
  /** Apaga a workspace inteira, numa transação com timeout próprio. */
  expurgar(ownerId: string): Promise<LinhasApagadas>;
}
