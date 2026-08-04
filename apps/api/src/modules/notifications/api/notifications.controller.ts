import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsQueryService } from '../application/notifications-query.service';
import { NotificationTargetsService } from '../application/notification-targets.service';
import {
  CurrentOwnerId,
  CurrentUserId,
} from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { CreateNotificationTargetDto } from './dto/create-notification-target.dto';
import { CreateWebhookTargetDto } from './dto/create-webhook-target.dto';
import { UpdateNotificationTargetDto } from './dto/update-notification-target.dto';
import { idDeRota } from '../../../shared/validation/validacao-em-pt-br';

/**
 * Central de notificações. **Sem `@RequirePermission`, de propósito**: a caixa é
 * do próprio usuário, como o Perfil e `GET /workspace/members`. Uma chave aqui
 * significaria "papel que pode receber notificação", que não é um conceito do
 * produto. O recorte é `userId` + `ownerId`, sempre os dois.
 *
 * Rotas estáticas antes das paramétricas — convenção do projeto.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsQueryService,
    private readonly targets: NotificationTargetsService,
  ) {}

  @Get()
  list(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(ownerId, userId, query);
  }

  @Get('unread-count')
  unreadCount(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.notifications.contarNaoLidas(ownerId, userId);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentOwnerId() ownerId: string, @CurrentUserId() userId: string) {
    return this.notifications.marcarTodasLidas(ownerId, userId);
  }

  // --- destinos e preferências (rotas estáticas, antes das paramétricas) ---

  @Get('targets')
  listTargets(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.targets.list(ownerId, userId);
  }

  /** Nesta fase só `EMAIL`: `IN_APP` já vem provisionado e não é criável. */
  @Post('targets')
  createTarget(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateNotificationTargetDto,
  ) {
    return this.targets.criarEmail(ownerId, userId, dto);
  }

  /**
   * Destino de integração (`WEBHOOK`/`SLACK`). **A permissão vai no método**, não
   * na classe: as demais rotas desta seção continuam livres, porque a caixa é do
   * próprio usuário. Só a integração é gateada — o conteúdo que ela envia para
   * fora carrega nome de cliente e valor de cobrança (D4).
   */
  @Post('targets/integrations')
  @RequirePermission('notificacao:integrar')
  createIntegration(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateWebhookTargetDto,
  ) {
    return this.targets.criarIntegracao(ownerId, userId, dto);
  }

  /** Ping de verificação: sem ele o destino nunca entrega (nasce `verified: false`). */
  @Post('targets/:id/verify')
  @RequirePermission('notificacao:integrar')
  @HttpCode(200)
  verifyTarget(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Param('id', idDeRota) id: string,
  ) {
    return this.targets.verificar(ownerId, userId, id);
  }

  @Patch('targets/:id')
  updateTarget(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Param('id', idDeRota) id: string,
    @Body() dto: UpdateNotificationTargetDto,
  ) {
    return this.targets.atualizar(ownerId, userId, id, dto);
  }

  @Delete('targets/:id')
  @HttpCode(204)
  async deleteTarget(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Param('id', idDeRota) id: string,
  ) {
    await this.targets.excluir(ownerId, userId, id);
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(
    @CurrentOwnerId() ownerId: string,
    @CurrentUserId() userId: string,
    @Param('id', idDeRota) id: string,
  ) {
    const ok = await this.notifications.marcarLida(ownerId, userId, id);
    // 404 (não 403): notificação de outra pessoa não deve nem revelar que existe.
    if (!ok) throw new NotFoundException('Notificação não encontrada.');
    return { ok: true };
  }
}
