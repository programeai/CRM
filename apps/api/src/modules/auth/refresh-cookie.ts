import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/** Nome e caminho do cookie de refresh — o path restringe o envio às rotas de auth. */
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Grava o cookie `httpOnly` do refresh token. Vive fora do controller porque o
 * aceite de convite (`modules/collaborators`) também emite sessão — os atributos
 * do cookie precisam ser idênticos nos dois caminhos, senão o refresh silenciosamente
 * deixa de funcionar num deles.
 */
export function setRefreshCookie(
  res: Response,
  token: string,
  config: ConfigService,
) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('NODE_ENV') === 'production',
    domain: config.get('COOKIE_DOMAIN'),
    path: REFRESH_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
