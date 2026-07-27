import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ProjectsController } from './api/projects.controller';
import { TasksController } from './api/tasks.controller';
import { ProjectsService } from './application/projects.service';
import { TasksService } from './application/tasks.service';
import { PROJECT_REPOSITORY } from './domain/project.repository';
import { TASK_REPOSITORY } from './domain/task.repository';
import { PrismaProjectRepository } from './infra/prisma-project.repository';
import { PrismaTaskRepository } from './infra/prisma-task.repository';

@Module({
  imports: [ClientsModule, WorkspaceModule],
  controllers: [ProjectsController, TasksController],
  providers: [
    ProjectsService,
    TasksService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    { provide: TASK_REPOSITORY, useClass: PrismaTaskRepository },
  ],
  exports: [ProjectsService], // consumido pelo PipelineModule na Fase 4 (criar-ao-ganhar)
})
export class ProjectsModule {}
