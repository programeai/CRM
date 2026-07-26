export const COLLABORATOR_REPOSITORY = Symbol('COLLABORATOR_REPOSITORY');

/**
 * Colaborador como o painel precisa dele — nunca com `passwordHash` nem
 * `refreshTokenHash`. O convite pendente é derivado de `acceptedAt` nulo.
 */
export interface CollaboratorView {
  id: string;
  name: string;
  email: string;
  active: boolean;
  acceptedAt: Date | null;
  createdAt: Date;
  role: { id: string; name: string; system: boolean } | null;
}

export interface CollaboratorRepository {
  /**
   * Colaboradores do owner. `User` **não** tem RLS (login busca por e-mail),
   * então todo método aqui filtra `ownerId` explicitamente — é esse filtro que
   * isola um owner do outro nesta tabela.
   */
  findManyByOwner(ownerId: string): Promise<CollaboratorView[]>;
  findByIdAndOwner(
    id: string,
    ownerId: string,
  ): Promise<CollaboratorView | null>;
  /** Nome do dono da workspace — vai no e-mail do convite ("X te convidou"). */
  findOwnerName(ownerId: string): Promise<string>;
  /** Busca global por e-mail (o unique é do banco inteiro, não por owner). */
  existsByEmail(email: string): Promise<boolean>;
  create(data: {
    ownerId: string;
    name: string;
    email: string;
    roleId: string;
  }): Promise<CollaboratorView>;
  update(
    id: string,
    ownerId: string,
    data: { roleId?: string; active?: boolean },
  ): Promise<CollaboratorView>;
  /** Revoga a sessão vigente (usado ao desativar). */
  revokeSession(id: string, ownerId: string): Promise<void>;
}
