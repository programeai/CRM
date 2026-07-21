import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientsService } from '../application/clients.service';
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@CurrentUserId() ownerId: string, @Query() query: ListClientsQueryDto) {
    return this.clients.list(ownerId, query);
  }

  @Post()
  create(@CurrentUserId() ownerId: string, @Body() dto: CreateClientDto) {
    return this.clients.create(ownerId, dto);
  }

  @Get(':id')
  findOne(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.clients.findOne(ownerId, id);
  }

  @Patch(':id')
  update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(ownerId, id, dto);
  }

  @Post(':id/archive')
  archive(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.clients.archive(ownerId, id);
  }
}
