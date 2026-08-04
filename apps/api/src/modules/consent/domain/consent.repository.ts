import type { ConsentRecord, ConsentSubjectType } from '@prisma/client';

export const CONSENT_REPOSITORY = Symbol('CONSENT_REPOSITORY');

/** O que grava uma manifestação. Não há `update` nem `delete`: ver a interface. */
export interface DadosDeConsentimento {
  ownerId: string;
  subjectType: ConsentSubjectType;
  subjectId: string;
  purpose: string;
  granted: boolean;
  textVersion: string;
  channel: string;
  evidence?: string | null;
  informedRetention?: string | null;
  recordedByUserId?: string | null;
  recordedByName: string;
  occurredAt: Date;
}

/**
 * **Só leitura e inserção.** Não há `update` nem `delete` aqui de propósito: o
 * banco os recusa para `crm_app` (`REVOKE UPDATE, DELETE`), e a interface não deve
 * prometer o que o banco proíbe. Revogar é `criar` outra linha com
 * `granted: false`.
 */
export interface ConsentRepository {
  /** Histórico completo de um titular, do mais recente para o mais antigo. */
  findHistorico(
    ownerId: string,
    subjectType: ConsentSubjectType,
    subjectId: string,
  ): Promise<ConsentRecord[]>;
  criar(dados: DadosDeConsentimento): Promise<ConsentRecord>;
  /**
   * Todas as linhas do owner, para o dump de portabilidade da 19-A. Ordem
   * cronológica: o dump é um registro, e registro se lê do começo.
   */
  carregarParaDump(ownerId: string): Promise<ConsentRecord[]>;
}
