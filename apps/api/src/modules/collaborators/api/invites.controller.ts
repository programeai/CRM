import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  InvitesService,
  INVITE_TTL_DAYS,
} from '../application/invites.service';
import { AuthService } from '../../auth/auth.service';
import { Public } from '../../auth/public.decorator';
import { setRefreshCookie } from '../../auth/refresh-cookie';
import { AllowWithoutSubscription } from '../../billing/allow-without-subscription.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';

/**
 * Aceite do convite de colaborador — rotas **públicas**: quem abre o link ainda
 * não tem sessão. Marcadas também com `@AllowWithoutSubscription()` porque
 * `@Public()` já isenta o gate de billing, mas a intenção fica explícita: o
 * convidado não é quem assina.
 *
 * As duas rotas respondem a **mesma** mensagem para token inexistente, expirado
 * ou já usado (ver `InvitesService`) — não há o que ganhar distinguindo.
 */
@Controller('collaborators/invite')
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** Dados para a tela de aceite: quem foi convidado e por qual conta. */
  @Public()
  @AllowWithoutSubscription()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get(':token')
  async preview(@Param('token') token: string) {
    const invite = await this.invites.preview(token);
    return { ...invite, expiresInDays: INVITE_TTL_DAYS };
  }

  /**
   * Define a senha, consome o convite (uso único) e **já autentica** — o link
   * chegou no e-mail do próprio colaborador, então pedir login em seguida seria
   * atrito sem ganho de segurança.
   */
  @Public()
  @AllowWithoutSubscription()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInviteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.invites.accept(token, dto.password);
    const { accessToken, refreshToken } = await this.auth.issueSession(userId);
    setRefreshCookie(res, refreshToken, this.config);
    return { accessToken };
  }
}
