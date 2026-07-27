export const WORKSPACE_MEMBER_REPOSITORY = Symbol(
  'WORKSPACE_MEMBER_REPOSITORY',
);

/** Pessoa da workspace como o seletor de responsável precisa — nada além disso. */
export interface WorkspaceMember {
  id: string;
  name: string;
  isOwner: boolean;
}

export interface WorkspaceMemberRepository {
  /** Owner + colaboradores ativos com convite aceito, ordenados por nome. */
  findManyByOwner(ownerId: string): Promise<WorkspaceMember[]>;
  /** O usuário é membro atribuível desta workspace (owner ou colaborador ACTIVE)? */
  isMember(ownerId: string, userId: string): Promise<boolean>;
}
