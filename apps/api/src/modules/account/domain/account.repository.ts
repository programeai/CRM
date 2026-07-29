import type { EncerramentoAgendado } from './account-deletion';

export const ACCOUNT_REPOSITORY = 'ACCOUNT_REPOSITORY';

/** O que o encerramento precisa saber do `User` — sem expor o registro cru. */
export interface ContaDoTitular {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  /**
   * NULL = o titular nunca escolheu senha (conta de login social). O hash pode
   * existir mesmo assim — é a senha aleatória do cadastro por OAuth —, então é
   * este campo que decide se dá para pedir senha na reautenticação.
   */
  passwordSetAt: Date | null;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
}

export interface AccountRepository {
  /** Caminho HTTP. `User` está fora do RLS: o filtro por id é o isolamento. */
  findById(ownerId: string): Promise<ContaDoTitular | null>;
  agendarEncerramento(
    ownerId: string,
    agendamento: EncerramentoAgendado,
  ): Promise<void>;
  cancelarEncerramento(ownerId: string): Promise<void>;
}
