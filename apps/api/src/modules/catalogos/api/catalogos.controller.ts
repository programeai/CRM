import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CatalogosService } from '../application/catalogos.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CatalogKindPipe } from './catalog-kind.pipe';
import type { CatalogKind } from '../domain/catalog-kind';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';

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

  /**
   * Não existe `PATCH`: o catálogo é só cadastrar, escolher e excluir. Renomear
   * nunca foi operação do produto (troca-se o item por outro, e o histórico
   * segue com o nome que valia), e a marca de follow-up deixou de ser móvel —
   * 'Follow-up' é tipo primitivo, semeado com a conta.
   */
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
