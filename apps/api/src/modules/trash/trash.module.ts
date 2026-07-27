import { Module } from '@nestjs/common';
import { TrashController } from './api/trash.controller';
import { TrashService } from './application/trash.service';
import { TRASH_REPOSITORY } from './domain/trash.repository';
import { PrismaTrashRepository } from './infra/prisma-trash.repository';

@Module({
  controllers: [TrashController],
  providers: [
    TrashService,
    { provide: TRASH_REPOSITORY, useClass: PrismaTrashRepository },
  ],
})
export class TrashModule {}
