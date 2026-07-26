import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientsService } from '../application/clients.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get()
  list(@CurrentOwnerId() ownerId: string, @Query() query: ListClientsQueryDto) {
    return this.clients.list(ownerId, query);
  }

  @RequirePermission('cliente:gerenciar')
  @Post()
  create(@CurrentOwnerId() ownerId: string, @Body() dto: CreateClientDto) {
    return this.clients.create(ownerId, dto);
  }

  // Rotas de tags declaradas antes de `:id` para não serem capturadas por ele.
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get('tags')
  listTags(@CurrentOwnerId() ownerId: string) {
    return this.clients.listTags(ownerId);
  }

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get('tags/usage')
  tagUsage(@CurrentOwnerId() ownerId: string, @Query('tag') tag: string) {
    return this.clients.tagUsage(ownerId, tag);
  }

  @RequirePermission('cliente:gerenciar')
  @Delete('tags')
  deleteTag(@CurrentOwnerId() ownerId: string, @Query('tag') tag: string) {
    return this.clients.deleteTag(ownerId, tag);
  }

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get(':id')
  findOne(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.clients.findOne(ownerId, id);
  }

  @RequirePermission('cliente:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(ownerId, id, dto);
  }

  @RequirePermission('cliente:gerenciar')
  @Post(':id/archive')
  archive(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.clients.archive(ownerId, id);
  }
}
