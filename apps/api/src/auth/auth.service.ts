import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
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
