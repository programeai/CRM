import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  type WorkspaceMember,
  type WorkspaceMemberRepository,
} from '../domain/workspace-member.repository';

@Injectable()
export class WorkspaceMembersService {
  constructor(
    @Inject(WORKSPACE_MEMBER_REPOSITORY)
    private readonly repo: WorkspaceMemberRepository,
  ) {}

  list(ownerId: string): Promise<WorkspaceMember[]> {
    return this.repo.findManyByOwner(ownerId);
  }

  /**
   * Trava obrigatória antes de gravar `assigneeId`: `assigneeId` referencia `User`,
   * que **não** tem RLS, então nem a FK nem a policy do próprio registro impedem
   * apontar o responsável para alguém de outra workspace.
   *
   * `null`/`undefined` passa direto — limpar o responsável é sempre válido.
   */
  async assertMember(ownerId: string, userId?: string | null): Promise<void> {
    if (!userId) return;
    if (!(await this.repo.isMember(ownerId, userId))) {
      throw new UnprocessableEntityException(
        'Responsável inválido: escolha alguém da sua equipe.',
      );
    }
  }
}
