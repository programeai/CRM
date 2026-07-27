import { Module } from '@nestjs/common';
import { WorkspaceMembersController } from './api/workspace-members.controller';
import { WorkspaceMembersService } from './application/workspace-members.service';
import { WORKSPACE_MEMBER_REPOSITORY } from './domain/workspace-member.repository';
import { PrismaWorkspaceMemberRepository } from './infra/prisma-workspace-member.repository';

/**
 * Quem são as pessoas da workspace. Exporta o service porque os módulos de negócio
 * precisam validar pertencimento antes de gravar `assigneeId`.
 */
@Module({
  controllers: [WorkspaceMembersController],
  providers: [
    WorkspaceMembersService,
    {
      provide: WORKSPACE_MEMBER_REPOSITORY,
      useClass: PrismaWorkspaceMemberRepository,
    },
  ],
  exports: [WorkspaceMembersService],
})
export class WorkspaceModule {}
