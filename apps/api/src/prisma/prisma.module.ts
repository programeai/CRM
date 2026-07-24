import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaAdminService } from './prisma-admin.service';

@Global()
@Module({
  providers: [PrismaService, PrismaAdminService],
  exports: [PrismaService, PrismaAdminService],
})
export class PrismaModule {}
