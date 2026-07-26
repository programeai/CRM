import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ContactsService } from '../application/contacts.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get('clients/:clientId/contacts')
  list(@CurrentOwnerId() ownerId: string, @Param('clientId') clientId: string) {
    return this.contacts.list(ownerId, clientId);
  }

  @RequirePermission('cliente:gerenciar')
  @Post('clients/:clientId/contacts')
  create(
    @CurrentOwnerId() ownerId: string,
    @Param('clientId') clientId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contacts.create(ownerId, clientId, dto);
  }

  @RequirePermission('cliente:gerenciar')
  @Patch('contacts/:id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(ownerId, id, dto);
  }

  @RequirePermission('cliente:gerenciar')
  @Delete('contacts/:id')
  remove(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.contacts.delete(ownerId, id);
  }
}
