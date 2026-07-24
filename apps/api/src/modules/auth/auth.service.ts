import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider } from '@prisma/client';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import type { OAuthProfile } from './oauth/oauth.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(name: string, email: string, password: string) {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }
    const user = await this.users.create({
      name,
      email,
      passwordHash: await argon2.hash(password),
    });
    return this.issueTokens(user.id);
  }

  /**
   * Entra ou cadastra via OAuth. Se a identidade do provedor já é conhecida,
   * loga direto. Caso contrário, vincula por e-mail **verificado** a uma conta
   * existente ou cria uma nova conta sem senha.
   */
  async oauthLogin(provider: OAuthProvider, profile: OAuthProfile) {
    const linked = await this.users.findByProviderAccount(
      provider,
      profile.providerAccountId,
    );
    if (linked) return this.issueTokens(linked.id);

    if (!profile.email || !profile.emailVerified) {
      throw new UnauthorizedException(
        'Não foi possível obter um e-mail verificado do provedor.',
      );
    }

    const existing = await this.users.findByEmail(profile.email);
    if (existing) {
      await this.users.linkOAuthAccount(
        existing.id,
        provider,
        profile.providerAccountId,
      );
      return this.issueTokens(existing.id);
    }

    const created = await this.users.createWithOAuth({
      name: profile.name,
      email: profile.email,
      provider,
      providerAccountId: profile.providerAccountId,
    });
    return this.issueTokens(created.id);
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (
      !user ||
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return this.issueTokens(user.id);
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.users.findById(userId);
    if (
      !user?.refreshTokenHash ||
      !(await argon2.verify(user.refreshTokenHash, refreshToken))
    ) {
      throw new UnauthorizedException();
    }
    return this.issueTokens(user.id);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const { passwordHash, refreshTokenHash, ...safe } = user;
    return safe;
  }

  async logout(userId: string) {
    await this.users.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(sub: string) {
    const accessToken = await this.jwt.signAsync(
      { sub },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_TTL'),
      },
    );
    await this.users.setRefreshTokenHash(sub, await argon2.hash(refreshToken));
    return { accessToken, refreshToken };
  }
}
