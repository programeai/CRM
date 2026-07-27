import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Identidade do **aparelho**, não da sessão. Sem ela, cada login abre uma linha
 * nova em `Session` e a tela "Dispositivos" vira uma lista de logins: o mesmo
 * navegador aparece cinco vezes, indistinguível, porque o rótulo é só
 * navegador+SO. Com ela, o login novo substitui a sessão anterior do mesmo
 * aparelho — um cookie, uma linha.
 *
 * É `httpOnly`: o valor não é segredo (não autentica nada sozinho), mas também
 * não tem por que ficar legível ao JS da página.
 */
export const DEVICE_COOKIE = 'device_id';

/**
 * Toda a API, e não só `/api/v1/auth`: o aceite de convite
 * (`POST /collaborators/invite/:token/accept`) também abre sessão.
 */
export const DEVICE_COOKIE_PATH = '/api/v1';

/** 400 dias — o teto que Chrome e Safari impõem a cookie persistente. */
export const DEVICE_COOKIE_TTL_MS = 400 * 24 * 60 * 60 * 1000;

/** O cookie vira filtro de query; só aceitamos de volta o que nós emitimos. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Devolve o `device_id` da requisição, emitindo um novo quando não vier (ou vier
 * adulterado). Reescreve o cookie sempre, para a validade deslizar junto com o
 * uso — aparelho ativo não perde a identidade por decurso de prazo.
 */
export function resolveDeviceId(
  req: Request,
  res: Response,
  config: ConfigService,
): string {
  const atual = (req.cookies as Record<string, string | undefined>)?.[
    DEVICE_COOKIE
  ];
  const deviceId = atual && UUID_V4.test(atual) ? atual : randomUUID();
  res.cookie(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('NODE_ENV') === 'production',
    domain: config.get('COOKIE_DOMAIN'),
    path: DEVICE_COOKIE_PATH,
    maxAge: DEVICE_COOKIE_TTL_MS,
  });
  return deviceId;
}
