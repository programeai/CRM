import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CollaboratorsService } from '../application/collaborators.service';
import { INVITE_TTL_DAYS } from '../application/invites.service';
import {
  CurrentAccess,
  CurrentOwnerId,
} from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import type { AccessContext } from '../../access/domain/access-context';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';

@Controller('collaborators')
@RequirePermission('colaborador:gerenciar')
export class CollaboratorsController {
  constructor(private readonly collaborators: CollaboratorsService) {}

  @Get()
  list(@CurrentOwnerId() ownerId: string) {
    return this.collaborators.list(ownerId);
  }

  /**
   * Convida: cria o colaborador sem senha e devolve o link do convite — que
   * também vai por e-mail. O link volta na resposta para o painel exibir (e o
   * fluxo seguir utilizável quando o SMTP não está configurado).
   */
  @Post()
  async create(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: CreateCollaboratorDto,
  ) {
    const result = await this.collaborators.invite(ownerId, dto);
    return { ...result, inviteExpiresInDays: INVITE_TTL_DAYS };
  }

  @Post(':id/invite')
  async resendInvite(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
  ) {
    const result = await this.collaborators.resendInvite(ownerId, id);
    return { ...result, inviteExpiresInDays: INVITE_TTL_DAYS };
  }

  @Patch(':id')
  update(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: UpdateCollaboratorDto,
  ) {
    // `requesterId` é a identidade (não a workspace): é o que impede alguém de
    // trocar o próprio papel ou se autodesativar.
    return this.collaborators.update(
      { ownerId: access.ownerId, requesterId: access.userId },
      id,
      dto,
    );
  }
}
