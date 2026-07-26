export const INVITE_REPOSITORY = Symbol('INVITE_REPOSITORY');

/** Convite com o convidado e o nome de quem convidou (exibido na página pública). */
export interface InviteWithUser {
  id: string;
  ownerId: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  user: {
    id: string;
    name: string;
    email: string;
    active: boolean;
    acceptedAt: Date | null;
  };
  owner: { name: string };
}

export interface InviteRepository {
  /**
   * Emite um convite e **invalida os anteriores** do mesmo usuário (só o último
   * link vale). Roda no contexto do owner.
   */
  replaceForUser(data: {
    ownerId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;

  /**
   * Localiza pelo hash **sem** consumir, para renderizar a página do convite.
   * Rota pública, sem contexto de owner → implementação usa o client admin.
   */
  findByTokenHash(tokenHash: string): Promise<InviteWithUser | null>;

  /**
   * Consome o convite e ativa o colaborador numa única transação: marca
   * `usedAt` (condicionado a `usedAt: null`, para dois envios simultâneos do
   * mesmo link não valerem duas vezes) e grava a senha + `acceptedAt`.
   * Devolve `false` quando o convite já havia sido consumido.
   */
  consumeAndActivate(data: {
    inviteId: string;
    userId: string;
    passwordHash: string;
  }): Promise<boolean>;
}
