import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RolesService } from '../application/roles.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Controller('roles')
// Gerir papéis é gerir o próprio acesso: uma permissão só, sem variante de leitura.
@RequirePermission('papel:gerenciar')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@CurrentOwnerId() ownerId: string) {
    return this.roles.list(ownerId);
  }

  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateRoleDto) {
    return this.roles.create(ownerId, dto);
  }

  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(ownerId, id, dto);
  }

  /** Remoção pontual de uma permissão, direto do detalhe do papel. */
  @Delete(':id/permissions/:key')
  removePermission(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Param('key') key: string,
  ) {
    return this.roles.removePermission(ownerId, id, key);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.roles.remove(ownerId, id);
  }
}
