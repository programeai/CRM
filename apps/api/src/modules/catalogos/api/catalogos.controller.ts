import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CatalogosService } from '../application/catalogos.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CatalogKindPipe } from './catalog-kind.pipe';
import type { CatalogKind } from '../domain/catalog-kind';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';

/**
 * Os catálogos são **do owner**: cada workspace tem os seus (`ownerId` + RLS),
 * criados junto com a conta e configuráveis sem afetar ninguém.
 *
 * A **leitura não exige permissão de módulo**, de propósito: o `Select` de tipo
 * de serviço aparece no formulário de oportunidade, de proposta E de projeto —
 * quem tem `proposta:gerenciar` precisa ler o catálogo sem necessariamente ter
 * `oportunidade:ver`. Mesma escolha de `GET /permissions`. A escrita é uma só
 * chave, `catalogo:gerenciar`, porque a tela de configuração é uma só.
 */
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get(':kind')
  list(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
  ) {
    return this.catalogos.list(ownerId, kind);
  }

  @RequirePermission('catalogo:gerenciar')
  @Post(':kind')
  create(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Body() dto: CreateCatalogItemDto,
  ) {
    return this.catalogos.create(ownerId, kind, dto);
  }

  @RequirePermission('catalogo:gerenciar')
  @Patch(':kind/:id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.catalogos.update(ownerId, kind, id, dto);
  }

  @RequirePermission('catalogo:gerenciar')
  @Delete(':kind/:id')
  remove(
    @CurrentOwnerId() ownerId: string,
    @Param('kind', CatalogKindPipe) kind: CatalogKind,
    @Param('id') id: string,
  ) {
    return this.catalogos.delete(ownerId, kind, id);
  }
}
