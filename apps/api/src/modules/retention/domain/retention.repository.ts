export const RETENTION_REPOSITORY = Symbol('RETENTION_REPOSITORY');

/** Linhas apagadas por tabela. `undefined` = a varredura não tocou a tabela. */
export type LinhasExpurgadas = Record<string, number>;

export interface RetentionRepository {
  /**
   * Lixeira: registros com `archivedAt` anterior ao corte. Em ordem topológica e
   * **sem cascata** — ver a implementação.
   *
   * Devolve também `pulados`: pai arquivado há tempo cujo filho NÃO está
   * arquivado não é apagado, e o silêncio de "0 linhas" seria lido como "nada a
   * fazer".
   */
  expurgarLixeira(
    cutoff: Date,
  ): Promise<{ contagem: LinhasExpurgadas; pulados: LinhasExpurgadas }>;
  expurgarNotificacoes(cutoff: Date): Promise<LinhasExpurgadas>;
  expurgarAuditoria(cutoff: Date): Promise<LinhasExpurgadas>;
}
