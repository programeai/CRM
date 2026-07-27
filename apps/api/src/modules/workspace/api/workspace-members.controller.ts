import { Controller, Get } from '@nestjs/common';
import { WorkspaceMembersService } from '../application/workspace-members.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';

/**
 * Sem `@RequirePermission`: qualquer pessoa que possa atribuir um registro precisa
 * escolher entre os membros, e exigir `colaborador:gerenciar` (como faz
 * `GET /collaborators`) fecharia o seletor para quem só cuida de demandas. O shape
 * é mínimo de propósito — nome e id, sem e-mail, papel ou situação de convite.
 * Mesmo desenho de `GET /permissions`.
 */
@Controller('workspace')
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get('members') list(@CurrentOwnerId() ownerId: string) {
    return this.members.list(ownerId);
  }
}
