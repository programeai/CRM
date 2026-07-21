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
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('clients/:clientId/contacts')
  list(@CurrentUserId() ownerId: string, @Param('clientId') clientId: string) {
    return this.contacts.list(ownerId, clientId);
  }

  @Post('clients/:clientId/contacts')
  create(
    @CurrentUserId() ownerId: string,
    @Param('clientId') clientId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contacts.create(ownerId, clientId, dto);
  }

  @Patch('contacts/:id')
  update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(ownerId, id, dto);
  }

  @Delete('contacts/:id')
  remove(@CurrentUserId() ownerId: string, @Param('id') id: string) {
    return this.contacts.delete(ownerId, id);
  }
}
