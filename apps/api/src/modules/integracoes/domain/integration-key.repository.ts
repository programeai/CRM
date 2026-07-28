export const INTEGRATION_KEY_REPOSITORY = Symbol('INTEGRATION_KEY_REPOSITORY');

/** A chave como o resto do sistema a conhece. NUNCA carrega o valor bruto. */
export interface IntegrationKeyRecord {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface IntegrationKeyRepository {
  findManyByOwner(ownerId: string): Promise<IntegrationKeyRecord[]>;
  findById(ownerId: string, id: string): Promise<IntegrationKeyRecord | null>;
  create(data: {
    ownerId: string;
    name: string;
    keyHash: string;
    prefix: string;
    scopes: string[];
  }): Promise<IntegrationKeyRecord>;
  /**
   * Troca o segredo da MESMA linha e zera `lastUsedAt`/`revokedAt`. Rotacionar
   * em vez de criar outra linha é o que mantém o canal apontando para a chave
   * sem religar FK — mesmo desenho do `replaceForUser` do convite.
   */
  replaceSecret(
    ownerId: string,
    id: string,
    data: { keyHash: string; prefix: string },
  ): Promise<IntegrationKeyRecord>;
  revoke(ownerId: string, id: string): Promise<IntegrationKeyRecord>;
  delete(ownerId: string, id: string): Promise<void>;
  /** Marca uso. Roda dentro do contexto de owner de quem usou a chave. */
  touch(ownerId: string, id: string): Promise<void>;
  /**
   * Busca pelo hash SEM contexto de owner — é a autenticação, que acontece
   * antes de existir `app.owner_id`. Client admin, como
   * `prisma-invite.repository.ts:37`.
   */
  findByHashPeloSistema(keyHash: string): Promise<IntegrationKeyRecord | null>;
}
