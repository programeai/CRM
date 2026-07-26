import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../../mail/mail.module';
import { RolesController } from './api/roles.controller';
import { CollaboratorsController } from './api/collaborators.controller';
import { InvitesController } from './api/invites.controller';
import { RolesService } from './application/roles.service';
import { CollaboratorsService } from './application/collaborators.service';
import { InvitesService } from './application/invites.service';
import { ROLE_REPOSITORY } from './domain/role.repository';
import { COLLABORATOR_REPOSITORY } from './domain/collaborator.repository';
import { INVITE_REPOSITORY } from './domain/invite.repository';
import { PrismaRoleRepository } from './infra/prisma-role.repository';
import { PrismaCollaboratorRepository } from './infra/prisma-collaborator.repository';
import { PrismaInviteRepository } from './infra/prisma-invite.repository';

/**
 * Colaboradores, papéis e convites da workspace. Importa `AuthModule` para
 * emitir a sessão no aceite do convite (o convidado já entra logado) e
 * `MailModule` para enviar o link.
 *
 * `InvitesController` vem primeiro: são as rotas públicas do aceite, e deixá-las
 * antes das rotas autenticadas de `/collaborators` mantém o mapeamento óbvio.
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [InvitesController, CollaboratorsController, RolesController],
  providers: [
    RolesService,
    CollaboratorsService,
    InvitesService,
    { provide: ROLE_REPOSITORY, useClass: PrismaRoleRepository },
    {
      provide: COLLABORATOR_REPOSITORY,
      useClass: PrismaCollaboratorRepository,
    },
    { provide: INVITE_REPOSITORY, useClass: PrismaInviteRepository },
  ],
})
export class CollaboratorsModule {}
