import { Inject, Injectable } from '@nestjs/common';
import {
  NOTIFICATION_REPOSITORY,
  type InboxItem,
  type NotificationRepository,
} from '../domain/notification.repository';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { ListNotificationsQueryDto } from '../api/dto/list-notifications-query.dto';

@Injectable()
export class NotificationsQueryService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: NotificationRepository,
  ) {}

  async list(
    ownerId: string,
    userId: string,
    query: ListNotificationsQueryDto,
  ) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findInboxAndCount({
      ownerId,
      userId,
      unreadOnly: query.unreadOnly,
      skip,
      take,
    });
    return paginated(data.map(paraItem), total, page, limit);
  }

  async contarNaoLidas(ownerId: string, userId: string) {
    return { count: await this.repo.contarNaoLidas(ownerId, userId) };
  }

  marcarLida(ownerId: string, userId: string, deliveryId: string) {
    return this.repo.marcarLida(ownerId, userId, deliveryId);
  }

  async marcarTodasLidas(ownerId: string, userId: string) {
    return { updated: await this.repo.marcarTodasLidas(ownerId, userId) };
  }
}

/** Achata a entrega + notificação num item de central. O front não vê o modelo cru. */
function paraItem(d: InboxItem) {
  return {
    id: d.id, // id da ENTREGA — é o que "marcar como lida" recebe
    type: d.notification.type,
    entity: d.notification.entity,
    entityId: d.notification.entityId,
    title: d.notification.title,
    body: d.notification.body,
    link: d.notification.link,
    readAt: d.readAt,
    createdAt: d.createdAt,
  };
}
