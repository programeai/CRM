import { Injectable, Logger } from '@nestjs/common';
import type { Session } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SESSION_TTL_MS } from './refresh-cookie';
import { describeUserAgent } from '../../shared/user-agent';

/** Contexto do dispositivo, colhido na fronteira HTTP (controller). */
export interface DeviceInfo {
  ip?: string | null;
  userAgent?: string | null;
  /** Cookie `device_id` — estável entre logins do mesmo aparelho. */
  deviceId?: string | null;
}

/** Sessão como o perfil consome — sem `tokenHash`, com rótulo pronto. */
export interface SessionView {
  id: string;
  device: string;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  /** `true` na sessão que fez esta requisição. */
  current: boolean;
}

/** User-Agent cabe em 255 — string maior que isso é ruído (ou ataque). */
const UA_MAX = 255;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * `prisma.db` de propósito: em rota pública (login/refresh) devolve o client
   * base, e em rota autenticada (logout/revogar) entra na transação do request.
   * `Session` não tem policy, então `app.owner_id` é irrelevante nos dois casos.
   */
  private get db() {
    return this.prisma.db;
  }

  private trim(ua?: string | null): string | null {
    return ua ? ua.slice(0, UA_MAX) : null;
  }

  /**
   * Cria a sessão do dispositivo. O `id` é o `sid` que vai no payload dos JWTs.
   *
   * Um aparelho, uma sessão ativa: antes de inserir, revoga o que já houver com
   * o mesmo `deviceId`. Sem isso, cada login empilha uma linha e "Dispositivos"
   * lista logins. A linha antiga é revogada, não apagada — o histórico de quando
   * aquele aparelho entrou continua no banco.
   */
  async create(data: {
    id: string;
    userId: string;
    tokenHash: string;
    device: DeviceInfo;
  }): Promise<Session> {
    const deviceId = data.device.deviceId ?? null;
    if (deviceId) await this.revokePreviousOnDevice(data.userId, deviceId);
    return this.db.session.create({
      data: {
        id: data.id,
        userId: data.userId,
        tokenHash: data.tokenHash,
        deviceId,
        ip: data.device.ip ?? null,
        userAgent: this.trim(data.device.userAgent),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  /** Derruba a sessão que o aparelho tinha antes deste login. */
  private async revokePreviousOnDevice(userId: string, deviceId: string) {
    const { count } = await this.db.session.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) {
      this.logger.log({
        evento: 'sessao.substituida',
        msg: 'Login novo substituiu a sessão anterior do mesmo dispositivo.',
        quantidade: count,
      });
    }
  }

  findById(id: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { id } });
  }

  /**
   * Rotação: mesmo `sid`, token novo. Empurra `expiresAt` junto com o cookie
   * (janela deslizante) e reescreve IP/UA — a sessão passa a refletir onde ela
   * está sendo usada agora, não onde nasceu. É também o que adota a sessão
   * criada antes do cookie `device_id`: sem `deviceId` ela nunca colapsaria, e
   * aqui ela ganha o do aparelho que a está usando.
   */
  rotate(id: string, tokenHash: string, device: DeviceInfo): Promise<Session> {
    return this.db.session.update({
      where: { id },
      data: {
        tokenHash,
        lastUsedAt: new Date(),
        ip: device.ip ?? null,
        userAgent: this.trim(device.userAgent),
        // Só sobrescreve quando o cookie veio: refresh sem ele (cliente que não
        // guarda cookie, teste, curl) não pode zerar o aparelho já registrado.
        ...(device.deviceId ? { deviceId: device.deviceId } : {}),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  /** Sessões que ainda valem, da mais usada recentemente para a mais antiga. */
  findActiveByUser(userId: string): Promise<Session[]> {
    return this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * Revoga uma sessão do próprio usuário. `updateMany` com os dois filtros:
   * `Session` não tem RLS, então o `userId` é o que impede revogar a sessão de
   * outra pessoa. Devolve `false` quando nada foi afetado (id alheio/inexistente).
   */
  async revoke(id: string, userId: string): Promise<boolean> {
    const { count } = await this.db.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
  }

  /** Revoga todas as sessões do usuário, com a opção de preservar a corrente. */
  async revokeAll(userId: string, exceptId?: string): Promise<number> {
    const { count } = await this.db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Lista as sessões ativas do usuário, marcando qual é a corrente. */
  async listForUser(
    userId: string,
    currentSid?: string,
  ): Promise<SessionView[]> {
    const rows = await this.findActiveByUser(userId);
    return rows.map((s) => ({
      id: s.id,
      device: describeUserAgent(s.userAgent),
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSid,
    }));
  }
}
