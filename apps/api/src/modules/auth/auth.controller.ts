import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OAuthService } from './oauth/oauth.service';
import { CaptchaService } from './captcha/captcha.service';
import { Public } from './public.decorator';
import type { DeviceInfo } from './sessions.service';
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  setRefreshCookie,
} from './refresh-cookie';
import { resolveDeviceId } from './device-cookie';
import {
  CurrentAccess,
  CurrentSessionId,
  CurrentUserId,
} from '../../shared/current-user.decorator';
import type { AccessContext } from '../access/domain/access-context';

const OAUTH_STATE_COOKIE = 'oauth_state';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private jwt: JwtService,
    private config: ConfigService,
    private oauth: OAuthService,
    private captcha: CaptchaService,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    setRefreshCookie(res, token, this.config);
  }

  /**
   * Dispositivo da requisição — `req.ip` já é o IP real (trust proxy, ver
   * main.ts). Precisa do `res` porque emite o cookie `device_id` quando o
   * aparelho ainda não tem um.
   */
  private device(req: Request, res: Response): DeviceInfo {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId: resolveDeviceId(req, res, this.config),
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.captcha.verify(dto.captchaToken, req.ip);
    const { accessToken, refreshToken } = await this.auth.register(
      dto.name,
      dto.email,
      dto.password,
      this.device(req, res),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.auth.login(
      dto.email,
      dto.password,
      this.device(req, res),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Resposta genérica (anti-enumeração): não revela se o e-mail existe.
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string | undefined>)?.[
      REFRESH_COOKIE
    ];
    if (!token) throw new UnauthorizedException();
    let sub: string;
    let sid: string | undefined;
    try {
      ({ sub, sid } = await this.jwt.verifyAsync<{ sub: string; sid?: string }>(
        token,
        { secret: this.config.get<string>('JWT_REFRESH_SECRET') },
      ));
    } catch {
      throw new UnauthorizedException();
    }
    // Refresh emitido antes da Fase 8A não tem `sid`: não há sessão a validar,
    // e o usuário entra de novo. Some sozinho em 7 dias.
    if (!sid) throw new UnauthorizedException();
    const { accessToken, refreshToken } = await this.auth.refresh(
      sid,
      sub,
      token,
      this.device(req, res),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Get('me')
  me(@CurrentUserId() userId: string, @CurrentAccess() access: AccessContext) {
    return this.auth.me(userId, access);
  }

  @Patch('me')
  updateMe(@CurrentUserId() userId: string, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(userId, dto);
  }

  @Post('logout')
  async logout(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sid: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(userId, sid);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { ok: true };
  }

  /** Sessões ativas do próprio usuário (perfil → "Sessões ativas"). */
  @Get('sessions')
  sessions(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sid: string | undefined,
  ) {
    return this.auth.listSessions(userId, sid);
  }

  /** Encerra as demais sessões, preservando a atual. */
  @Delete('sessions')
  revokeOtherSessions(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sid: string | undefined,
  ) {
    return this.auth.revokeOtherSessions(userId, sid);
  }

  /** Encerra uma sessão específica do próprio usuário. */
  @Delete('sessions/:id')
  revokeSession(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.auth.revokeSession(userId, id);
  }

  /** Informa se o autocadastro está aberto, para a UI não oferecer o que a API recusa. */
  @Public()
  @Get('registration')
  registration() {
    return {
      enabled: this.config.get<boolean>('REGISTRATION_ENABLED') !== false,
    };
  }

  // --- OAuth (Google / GitHub) ---

  /** Informa quais provedores OAuth estão configurados, para a UI exibir só o que funciona. */
  @Public()
  @Get('oauth/providers')
  oauthProviders() {
    return {
      google: this.oauth.isEnabled('google'),
      github: this.oauth.isEnabled('github'),
    };
  }

  /** Início do fluxo: gera o `state` anti-CSRF e redireciona ao provedor. */
  @Public()
  @Get('oauth/:provider')
  oauthStart(@Param('provider') providerSlug: string, @Res() res: Response) {
    const provider = this.oauth.resolveProvider(providerSlug);
    if (!this.oauth.isEnabled(provider)) {
      return res.redirect(this.frontendError('oauth_indisponivel'));
    }
    const state = randomBytes(32).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      domain: this.config.get('COOKIE_DOMAIN'),
      path: '/api/v1/auth',
      maxAge: 10 * 60 * 1000,
    });
    return res.redirect(this.oauth.buildAuthorizeUrl(provider, state));
  }

  /** Callback: valida o `state`, troca o `code`, autentica e volta ao frontend. */
  @Public()
  @Get('oauth/:provider/callback')
  async oauthCallback(
    @Param('provider') providerSlug: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/v1/auth' });
    try {
      const provider = this.oauth.resolveProvider(providerSlug);
      const cookieState = (req.cookies as Record<string, string | undefined>)?.[
        OAUTH_STATE_COOKIE
      ];
      if (!code || !state || !cookieState || state !== cookieState) {
        return res.redirect(this.frontendError('oauth'));
      }
      const profile = await this.oauth.exchangeCode(provider, code);
      const { refreshToken } = await this.auth.oauthLogin(
        this.oauth.enumOf(provider),
        profile,
        this.device(req, res),
      );
      this.setRefreshCookie(res, refreshToken);
      return res.redirect(this.config.get<string>('FRONTEND_URL') ?? '/');
    } catch (erro) {
      // O gate de cadastro não é falha de OAuth: merece mensagem própria no
      // login, senão o usuário lê "erro no login social" e tenta de novo.
      if (erro instanceof ForbiddenException) {
        return res.redirect(this.frontendError('cadastro_desativado'));
      }
      return res.redirect(this.frontendError('oauth'));
    }
  }

  private frontendError(code: string): string {
    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    return `${base}/login?error=${code}`;
  }
}
