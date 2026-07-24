import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verificação de captcha (Cloudflare Turnstile). Sem `TURNSTILE_SECRET_KEY`
 * configurado, a verificação é ignorada — mantém o fluxo utilizável em dev.
 */
@Injectable()
export class CaptchaService {
  constructor(private config: ConfigService) {}

  private get secret(): string {
    return this.config.get<string>('TURNSTILE_SECRET_KEY') ?? '';
  }

  isEnabled(): boolean {
    return Boolean(this.secret);
  }

  /** Valida o token do widget; lança 400 se ausente ou inválido. */
  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    if (!this.isEnabled()) return;
    if (!token) {
      throw new BadRequestException('Confirme que você não é um robô.');
    }
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let success = false;
    try {
      const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
      const data = (await res.json()) as { success?: boolean };
      success = data.success === true;
    } catch {
      success = false;
    }
    if (!success) {
      throw new BadRequestException(
        'Falha na verificação do captcha. Tente novamente.',
      );
    }
  }
}
