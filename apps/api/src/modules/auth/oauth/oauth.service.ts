import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider } from '@prisma/client';

/** Provedores suportados, na forma usada na URL (`/auth/oauth/:provider`). */
export type ProviderSlug = 'google' | 'github';

/** Perfil normalizado extraído do provedor, independente da origem. */
export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}

interface ProviderConfig {
  enumValue: OAuthProvider;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientIdKey: string;
  clientSecretKey: string;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

@Injectable()
export class OAuthService {
  constructor(private config: ConfigService) {}

  private readonly providers: Record<ProviderSlug, ProviderConfig> = {
    google: {
      enumValue: OAuthProvider.GOOGLE,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
      clientIdKey: 'GOOGLE_CLIENT_ID',
      clientSecretKey: 'GOOGLE_CLIENT_SECRET',
      fetchProfile: (token) => this.fetchGoogleProfile(token),
    },
    github: {
      enumValue: OAuthProvider.GITHUB,
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scope: 'read:user user:email',
      clientIdKey: 'GITHUB_CLIENT_ID',
      clientSecretKey: 'GITHUB_CLIENT_SECRET',
      fetchProfile: (token) => this.fetchGithubProfile(token),
    },
  };

  /** Valida o slug da URL e retorna o provedor, ou lança 400. */
  resolveProvider(slug: string): ProviderSlug {
    if (slug === 'google' || slug === 'github') return slug;
    throw new BadRequestException('Provedor de login não suportado.');
  }

  enumOf(slug: ProviderSlug): OAuthProvider {
    return this.providers[slug].enumValue;
  }

  /** Um provedor só está habilitado se as duas credenciais estiverem presentes. */
  isEnabled(slug: ProviderSlug): boolean {
    const p = this.providers[slug];
    return Boolean(
      this.config.get<string>(p.clientIdKey) &&
        this.config.get<string>(p.clientSecretKey),
    );
  }

  private redirectUri(slug: ProviderSlug): string {
    const base = this.config.get<string>('API_URL');
    return `${base}/api/v1/auth/oauth/${slug}/callback`;
  }

  /** URL do provedor para onde o usuário é redirecionado, com o `state` anti-CSRF. */
  buildAuthorizeUrl(slug: ProviderSlug, state: string): string {
    const p = this.providers[slug];
    const params = new URLSearchParams({
      client_id: this.config.get<string>(p.clientIdKey) ?? '',
      redirect_uri: this.redirectUri(slug),
      response_type: 'code',
      scope: p.scope,
      state,
    });
    if (slug === 'google') {
      params.set('access_type', 'online');
      params.set('prompt', 'select_account');
    }
    return `${p.authorizeUrl}?${params.toString()}`;
  }

  /** Troca o `code` por um access token e retorna o perfil normalizado. */
  async exchangeCode(slug: ProviderSlug, code: string): Promise<OAuthProfile> {
    const p = this.providers[slug];
    const body = new URLSearchParams({
      client_id: this.config.get<string>(p.clientIdKey) ?? '',
      client_secret: this.config.get<string>(p.clientSecretKey) ?? '',
      code,
      redirect_uri: this.redirectUri(slug),
      grant_type: 'authorization_code',
    });
    const res = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    });
    if (!res.ok) {
      throw new BadRequestException('Falha ao autenticar com o provedor.');
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new BadRequestException('Falha ao autenticar com o provedor.');
    }
    return p.fetchProfile(data.access_token);
  }

  private async fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
    const res = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new BadRequestException('Não foi possível obter os dados do Google.');
    }
    const u = (await res.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    return {
      providerAccountId: u.sub,
      email: u.email ?? null,
      emailVerified: u.email_verified === true,
      name: u.name || u.email || 'Usuário',
    };
  }

  private async fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'crm-programeai',
    };
    const res = await fetch('https://api.github.com/user', { headers });
    if (!res.ok) {
      throw new BadRequestException('Não foi possível obter os dados do GitHub.');
    }
    const u = (await res.json()) as {
      id: number;
      login: string;
      name?: string | null;
    };
    // O e-mail pode ser privado; busca-se o primário verificado em /user/emails.
    let email: string | null = null;
    let emailVerified = false;
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers,
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary =
        emails.find((e) => e.primary && e.verified) ??
        emails.find((e) => e.verified);
      if (primary) {
        email = primary.email;
        emailVerified = true;
      }
    }
    return {
      providerAccountId: String(u.id),
      email,
      emailVerified,
      name: u.name || u.login || 'Usuário',
    };
  }
}
