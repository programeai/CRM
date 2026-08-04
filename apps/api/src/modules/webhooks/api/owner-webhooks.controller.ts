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
import { idDeRota } from '../../../shared/validation/validacao-em-pt-br';
import { OwnerWebhooksService } from '../application/owner-webhooks.service';
import { OWNER_WEBHOOK_EVENTS } from '../domain/owner-webhook-event';
import { CreateOwnerWebhookDto } from './dto/create-owner-webhook.dto';
import { UpdateOwnerWebhookDto } from './dto/update-owner-webhook.dto';

/**
 * Webhooks **da workspace** — o owner cadastra endereços que recebem os eventos
 * de negócio. Não confundir com `POST /notifications/targets/integrations`, que é
 * destino **do usuário** (o Slack pessoal, o n8n de casa) e carrega preferência
 * de notificação: a distinção é a que o plano da Fase 9 mandou manter escrita.
 *
 * Toda rota exige `webhook:gerenciar`, e a permissão é própria (não reusa
 * `notificacao:integrar`) porque o risco é de outra ordem: o que sai por aqui é
 * o evento de negócio da workspace inteira, não o aviso de uma pessoa.
 */
@Controller('webhooks')
export class OwnerWebhooksController {
  constructor(private readonly service: OwnerWebhooksService) {}

  /** Catálogo de eventos — o front consome os rótulos daqui, não os duplica. */
  @Get('eventos')
  @RequirePermission('webhook:gerenciar')
  eventos() {
    return OWNER_WEBHOOK_EVENTS;
  }

  @Get()
  @RequirePermission('webhook:gerenciar')
  list(@CurrentOwnerId() ownerId: string) {
    return this.service.list(ownerId);
  }

  /** Devolve o segredo de assinatura — a única vez que ele existe. */
  @Post()
  @RequirePermission('webhook:gerenciar')
  criar(@CurrentOwnerId() ownerId: string, @Body() dto: CreateOwnerWebhookDto) {
    return this.service.criar(ownerId, dto);
  }

  @Patch(':id')
  @RequirePermission('webhook:gerenciar')
  atualizar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
    @Body() dto: UpdateOwnerWebhookDto,
  ) {
    return this.service.atualizar(ownerId, id, dto);
  }

  /** Ping de verificação: sem ele o webhook nunca entrega (nasce inativo). */
  @Post(':id/verify')
  @RequirePermission('webhook:gerenciar')
  @HttpCode(200)
  verificar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
  ) {
    return this.service.verificar(ownerId, id);
  }

  /** Troca o segredo. A assinatura anterior deixa de casar na hora. */
  @Post(':id/rotate-secret')
  @RequirePermission('webhook:gerenciar')
  @HttpCode(200)
  rotacionar(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
  ) {
    return this.service.rotacionarSegredo(ownerId, id);
  }

  @Delete(':id')
  @RequirePermission('webhook:gerenciar')
  @HttpCode(204)
  excluir(
    @CurrentOwnerId() ownerId: string,
    @Param('id', idDeRota) id: string,
  ) {
    return this.service.excluir(ownerId, id);
  }
}
