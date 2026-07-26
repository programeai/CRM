import { Controller, Get } from '@nestjs/common';
import { permissionCatalog } from '../../../shared/permissions';

/**
 * Catálogo de permissões para o frontend montar o editor de papéis e exibir as
 * permissões de um papel. Fonte única dos rótulos em pt-BR — o `apps/web` **não**
 * duplica esses textos.
 *
 * Só exige sessão válida: qualquer usuário logado pode ler o catálogo (é uma
 * lista estática de rótulos, não revela dado de ninguém).
 */
@Controller('permissions')
export class PermissionsController {
  @Get()
  list() {
    return permissionCatalog();
  }
}
