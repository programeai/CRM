import { Module } from '@nestjs/common';
import { CatalogosController } from './api/catalogos.controller';
import { CatalogosService } from './application/catalogos.service';
import { CATALOG_REPOSITORY } from './domain/catalog.repository';
import { PrismaCatalogRepository } from './infra/prisma-catalog.repository';

/**
 * Não importa nenhum módulo de negócio — `contarUsos` fala com o Prisma direto.
 * É o que mantém o grafo acíclico: clients, pipeline, proposals, projects e
 * activities importam ESTE módulo, nunca o contrário.
 */
@Module({
  controllers: [CatalogosController],
  providers: [
    CatalogosService,
    { provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
  ],
  exports: [CatalogosService],
})
export class CatalogosModule {}
