import type { UserTotp } from '@prisma/client';

export const TOTP_REPOSITORY = Symbol('TOTP_REPOSITORY');

/** O que grava/atualiza o segundo fator de um usuário. */
export interface DadosDoSegredo {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export interface TotpRepository {
  find(userId: string): Promise<UserTotp | null>;
  /**
   * Grava (ou substitui) o segredo, com `confirmedAt: null` e contadores zerados.
   * Substituir é o caminho de "iniciei o cadastro e recomecei": um segredo não
   * confirmado não vale nada, e manter o antigo só deixaria lixo.
   */
  upsertSegredo(userId: string, dados: DadosDoSegredo): Promise<UserTotp>;
  /** Marca confirmado. É este campo que liga o 2FA da conta. */
  confirmar(userId: string, quando: Date): Promise<void>;
  /** Grava o passo aceito (anti-replay) e ZERA as falhas — sucesso limpa o placar. */
  registrarSucesso(userId: string, passo: bigint): Promise<void>;
  /**
   * Incrementa a falha e, se o incremento cruzou `MAX_FALHAS`, grava a trava.
   * Devolve o estado resultante — é ele que a mensagem de erro usa.
   *
   * A decisão da trava mora aqui, e não em quem chama, porque ela depende do
   * contador REAL depois do incremento: decidir antes de ir ao banco abriria
   * corrida entre duas tentativas simultâneas.
   */
  registrarFalha(
    userId: string,
  ): Promise<Pick<UserTotp, 'failedAttempts' | 'lockedUntil'>>;
  /**
   * Apaga o segredo **e os códigos de recuperação**. Os dois à mão:
   * `UserTotpRecoveryCode` referencia `User`, não `UserTotp`, então não há
   * cascata entre eles — ver a implementação.
   */
  apagar(userId: string): Promise<void>;

  // --- códigos de recuperação ---
  /** Substitui TODOS os códigos do usuário pelos hashes informados. */
  substituirCodigos(userId: string, hashes: string[]): Promise<void>;
  /** Quantos códigos ainda não foram usados. */
  contarCodigosDisponiveis(userId: string): Promise<number>;
  /**
   * Consome UM código por hash, em compare-and-swap: `updateMany` com
   * `{ userId, codeHash, usedAt: null }`. Devolve `true` só se a linha era do
   * usuário e ainda estava livre — é o que faz dois usos simultâneos do mesmo
   * código resultarem em um único consumo.
   */
  consumirCodigo(userId: string, codeHash: string): Promise<boolean>;
}
