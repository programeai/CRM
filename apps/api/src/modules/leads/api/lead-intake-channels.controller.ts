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
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { LeadIntakeChannelsService } from '../application/lead-intake-channels.service';
import { CreateLeadIntakeChannelDto } from './dto/create-lead-intake-channel.dto';
import { UpdateLeadIntakeChannelDto } from './dto/update-lead-intake-channel.dto';
import { idDeRota } from '../../../shared/validation/validacao-em-pt-br';

/**
 * Canais de captação do owner: quem recebe lead de fora, com que responsável e
 * classificado por qual fonte de lead.
 *
 * `integracao:gerenciar` em todas as rotas — inclusive na leitura: a listagem
 * exibe o prefixo da chave de cada canal, e quem não pode emitir credencial
 * também não precisa ver quais existem.
 */
@Controller('leads/canais')
export class LeadIntakeChannelsController {
  constructor(private readonly service: LeadIntakeChannelsService) {}

  @Get()
  @RequirePermission('integracao:gerenciar')
  list(@CurrentOwnerId() ownerId: string) {
    return this.service.list(ownerId);
  }

  /** A ÚNICA resposta da API que carrega o valor bruto da chave do canal. */
  @Post()
  @RequirePermission('integracao:gerenciar')
  create(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: CreateLeadIntakeChannelDto,
  ) {
    return this.service.create(ownerId, dto);
  }

  @Patch(':id')
  @RequirePermission('integracao:gerenciar')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
    @Body() dto: UpdateLeadIntakeChannelDto,
  ) {
    return this.service.update(ownerId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('integracao:gerenciar')
  @HttpCode(204)
  remove(@CurrentOwnerId() ownerId: string, @Param('id', idDeRota) id: string) {
    return this.service.delete(ownerId, id);
  }
}
